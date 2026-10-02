// Reconciles tagging runs for newly added screenshots (data/tag-runs/new/):
// pass1-<task>.json (full tags) vs pass2-<task>.json (independent company +
// category check). Agreements are accepted; disagreements go to
// data/agent-batches/new-disputes.json until decided in
// data/tag-runs/new/adjudicated.json. Writes data/tags/records-new.json.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, GEN_DIR, readJson, writeJson, slugify } from './lib/common.mjs';

const RUNS = path.join(DATA_DIR, 'tag-runs', 'new');
const TASKS = path.join(DATA_DIR, 'agent-batches', 'tasks');
const cats = new Set(readJson(path.join(DATA_DIR, 'vocab', 'categories.json')).map((c) => c.id));
const tagIds = new Set(readJson(path.join(DATA_DIR, 'vocab', 'tags.json')).map((t) => t.id));
const known = readJson(path.join(GEN_DIR, 'companies.json'), []).filter((c) => c.slug !== 'unknown');
const bySlug = new Map(known.map((c) => [c.slug, c]));
const byName = new Map(known.map((c) => [c.name.toLowerCase(), c]));

const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Map an agent's company answer onto an existing company when it is the same brand. */
function canonical(slug, name) {
  const s = slugify(slug || name || 'unknown') || 'unknown';
  const hit = bySlug.get(s) ?? byName.get(String(name ?? '').toLowerCase()) ?? known.find((c) => norm(c.slug) === norm(s) || norm(c.name) === norm(name));
  return hit ? { slug: hit.slug, name: hit.name } : { slug: s, name: s === 'unknown' ? 'Unknown' : name };
}

const taskIds = fs.readdirSync(TASKS).filter((f) => /^N\d+\.json$/.test(f)).map((f) => f.replace('.json', '')).sort();
const decided = new Map((readJson(path.join(RUNS, 'adjudicated.json'), { decisions: [] }).decisions ?? []).map((d) => [d.id, d]));
const records = [];
const disputes = [];
const problems = [];

for (const task of taskIds) {
  const manifest = readJson(path.join(TASKS, `${task}.json`));
  const ids = new Set(manifest.images.map((i) => i.id));
  const p1 = readJson(path.join(RUNS, `pass1-${task}.json`), null);
  const p2 = readJson(path.join(RUNS, `pass2-${task}.json`), null);
  if (!p1 || !p2) { problems.push(`${task}: missing ${!p1 ? 'pass1' : ''} ${!p2 ? 'pass2' : ''}`.trim()); continue; }
  const second = new Map(p2.records.map((r) => [r.id, r]));
  const seen = new Set();
  for (const r0 of p1.records) {
    if (!ids.has(r0.id)) { problems.push(`${task}: unknown id ${r0.id}`); continue; }
    seen.add(r0.id);
    const r = { ...r0, alt: decode(r0.alt), headline: decode(r0.headline), categoryAlternates: (r0.categoryAlternates ?? []).filter((c) => cats.has(c)), filenameDisagree: false };
    if (!cats.has(r.category)) problems.push(`${task}/${r.id}: bad category ${r.category}`);
    r.tags = (r.tags ?? []).filter((t) => tagIds.has(t.id) && (t.confidence === 'high' || t.confidence === 'medium'));
    const c1 = canonical(r.companySlug, r.companyName);
    const b = second.get(r.id);
    const c2 = b ? canonical(b.companySlug, b.companyName) : null;
    const d = decided.get(r.id);
    if (d) {
      const c = canonical(d.companySlug, d.companyName);
      Object.assign(r, { companySlug: c.slug, companyName: c.name, category: d.category, companyConfidence: d.companyConfidence ?? 'medium', categoryConfidence: d.categoryConfidence ?? 'medium', domain: d.domain ?? r.domain ?? null });
    } else if (b && (c1.slug !== c2.slug || r.category !== b.category)) {
      disputes.push({ task, id: r.id, batch: manifest.images.find((i) => i.id === r.id)?.batch, pass1: { company: c1.slug, name: c1.name, category: r.category }, pass2: { company: c2.slug, name: c2.name, category: b.category } });
      Object.assign(r, { companySlug: c1.slug, companyName: c1.name });
    } else {
      Object.assign(r, { companySlug: c1.slug, companyName: c1.name });
    }
    records.push(r);
  }
  for (const id of ids) if (!seen.has(id)) problems.push(`${task}: no record for ${id}`);
}

writeJson(path.join(DATA_DIR, 'agent-batches', 'new-disputes.json'), disputes);
if (problems.length) console.warn(`Problems:\n  ${problems.join('\n  ')}`);
if (disputes.length) {
  console.log(`${records.length} records read; ${disputes.length} disputes need a decision (data/agent-batches/new-disputes.json). Nothing written.`);
  process.exit(2);
}
writeJson(path.join(DATA_DIR, 'tags', 'records-new.json'), records);
const newCompanies = [...new Set(records.map((r) => r.companySlug))].filter((s) => s !== 'unknown' && !bySlug.has(s));
console.log(`Wrote ${records.length} records to data/tags/records-new.json | existing companies matched: ${new Set(records.map((r) => r.companySlug).filter((s) => bySlug.has(s))).size} | new companies: ${newCompanies.length}`);
