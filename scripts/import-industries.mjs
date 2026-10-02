// Reconciles two independent industry classifications (data/tag-runs/industries-a|b.json).
// Agreements are accepted; disagreements are written to
// data/agent-batches/industry-disputes.json for adjudication, and decisions in
// data/tag-runs/industries-adjudicated.json (if present) win.
// Output: data/industries.json  { companySlug: [primaryId, secondaryId?] }
// Usage: node scripts/import-industries.mjs [suffix]  — a suffix (e.g. 2) reads
// industries-a2/-b2/-adjudicated2 and industry-input2, and merges into the existing file.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, readJson, writeJson } from './lib/common.mjs';

const runs = path.join(DATA_DIR, 'tag-runs');
const sfx = process.argv[2] ?? '';
const vocab = new Set(readJson(path.join(DATA_DIR, 'vocab', 'industries.json')).map((i) => i.id));
const load = (f) => new Map((readJson(path.join(runs, f), { companies: [] }).companies ?? []).map((c) => [c.slug, c]));
const a = load(`industries-a${sfx}.json`);
const b = load(`industries-b${sfx}.json`);
const decided = load(`industries-adjudicated${sfx}.json`);
const input = readJson(path.join(DATA_DIR, 'agent-batches', `industry-input${sfx}.json`));

const clean = (r) => {
  if (!r) return null;
  const primary = vocab.has(r.primary) ? r.primary : 'other';
  const secondary = r.secondary && vocab.has(r.secondary) && r.secondary !== primary && r.secondary !== 'other' ? r.secondary : null;
  return { primary, secondary };
};
const same = (x, y) => x && y && x.primary === y.primary && x.secondary === y.secondary;

const out = sfx ? readJson(path.join(DATA_DIR, 'industries.json'), {}) : {};
const disputes = [];
for (const c of input) {
  const ra = clean(a.get(c.slug));
  const rb = clean(b.get(c.slug));
  const d = clean(decided.get(c.slug));
  const pick = d ?? (same(ra, rb) ? ra : null);
  if (pick) out[c.slug] = [pick.primary, pick.secondary].filter(Boolean);
  else disputes.push({ ...c, a: a.get(c.slug) ?? null, b: b.get(c.slug) ?? null });
}

writeJson(path.join(DATA_DIR, 'agent-batches', `industry-disputes${sfx}.json`), disputes);
writeJson(path.join(DATA_DIR, 'industries.json'), out);
const counts = {};
for (const ids of Object.values(out)) counts[ids[0]] = (counts[ids[0]] ?? 0) + 1;
console.log(`Industries: ${Object.keys(out).length} companies resolved, ${disputes.length} disputed (see data/agent-batches/industry-disputes.json)`);
console.log('Primary counts:', Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join(' '));
if (!fs.existsSync(path.join(runs, `industries-a${sfx}.json`)) || !fs.existsSync(path.join(runs, `industries-b${sfx}.json`))) console.warn('Missing a classification run.');
