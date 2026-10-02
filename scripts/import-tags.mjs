// Imports a tag-sections workflow result (JSON) into data/tags/records.json,
// applying adjudication decisions, audit fixes and company normalisation.
// Usage: node scripts/import-tags.mjs <workflow-output.json>
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, readJson, writeJson, slugify } from './lib/common.mjs';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/import-tags.mjs <workflow-output.json>'); process.exit(1); }
const raw = readJson(src);
const result = raw.result ?? raw;

// Keep the raw run for provenance (outside data/tags so merge ignores it).
const runsDir = path.join(DATA_DIR, 'tag-runs');
fs.mkdirSync(runsDir, { recursive: true });
fs.copyFileSync(src, path.join(runsDir, `${path.basename(src, '.output')}.json`));

const { items } = readJson(path.join(DATA_DIR, 'inventory.json'));
const inv = new Map(items.map((it) => [it.id, it]));

const decisions = new Map(result.tasks.flatMap((t) => t.decisions ?? []).map((d) => [d.id, d]));
const companyMap = new Map((result.companies ?? []).map((c) => [slugify(c.fromSlug), c]));
const fixes = new Map();
for (const f of result.audit?.fixes ?? []) {
  const prev = fixes.get(f.id) ?? { removeTags: [], addTags: [] };
  fixes.set(f.id, { removeTags: [...prev.removeTags, ...f.removeTags], addTags: [...prev.addTags, ...f.addTags] });
}

// Agents occasionally emit HTML entities; Astro escapes text itself.
const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const records = [];
const companyMeta = readJson(path.join(DATA_DIR, 'companies.json'), {});
let adjudicated = 0, normalised = 0, fixed = 0;

for (const task of result.tasks) {
  for (const r0 of task.records) {
    const it = inv.get(r0.id);
    if (!it) { console.warn(`  unknown id ${r0.id} in ${task.taskId}`); continue; }
    const r = { ...r0, tags: [...r0.tags], alt: decode(r0.alt), headline: decode(r0.headline) };
    const d = decisions.get(r.id);
    if (d) {
      Object.assign(r, {
        companyName: d.companyName, companySlug: d.companySlug, domain: d.domain ?? r.domain ?? null,
        companyConfidence: d.companyConfidence, category: d.category, categoryConfidence: d.categoryConfidence,
      });
      adjudicated++;
    }
    if (it.kind === 'jpeg') {
      r.companySlug = it.company; // filename is authoritative
    } else {
      const n = companyMap.get(slugify(r.companySlug));
      if (n) {
        const to = slugify(n.toSlug) || 'unknown';
        if (to !== r.companySlug || n.name !== r.companyName) normalised++;
        r.companySlug = to;
        if (to !== 'unknown') {
          r.companyName = n.name;
          companyMeta[to] = { ...companyMeta[to], name: companyMeta[to]?.name ?? n.name, ...(n.domain && !companyMeta[to]?.domain ? { domain: n.domain } : {}) };
        }
      }
      r.companySlug = slugify(r.companySlug) || 'unknown';
    }
    const f = fixes.get(r.id);
    if (f) {
      r.tags = r.tags.filter((t) => !f.removeTags.includes(t.id));
      for (const t of f.addTags) if (!r.tags.some((x) => x.id === t)) r.tags.push({ id: t, confidence: 'medium' });
      fixed++;
    }
    records.push(r);
  }
}

const seen = new Set(records.map((r) => r.id));
const missing = items.filter((it) => !seen.has(it.id));
writeJson(path.join(DATA_DIR, 'tags', 'records.json'), records);
writeJson(path.join(DATA_DIR, 'companies.json'), companyMeta);
writeJson(path.join(DATA_DIR, 'missing-tags.json'), missing.map((it) => ({ id: it.id, file: it.file, batch: it.batch })));

const weak = (result.audit?.perTag ?? []).filter((p) => p.checked && p.wrong / p.checked >= 0.34);
console.log(`Imported ${records.length} records | adjudicated ${adjudicated} | company-normalised ${normalised} | audit-fixed ${fixed} | missing ${missing.length}`);
if (weak.length) console.log(`Weak tags (≥1/3 wrong in audit): ${weak.map((p) => `${p.tag} ${p.wrong}/${p.checked}${p.pattern ? ` — ${p.pattern}` : ''}`).join('\n  ')}`);
