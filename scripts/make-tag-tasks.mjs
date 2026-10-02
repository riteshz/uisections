// Splits the inventory into tagging tasks for the AI workflow.
// WebP capture batches are never split (one agent sees a whole site);
// JPEGs are grouped by company. Writes data/agent-batches/*.json.
import path from 'node:path';
import { DATA_DIR, CACHE_DIR, readJson, writeJson } from './lib/common.mjs';

const TARGET = Number(process.env.TASK_SIZE ?? 45);
const OUT = path.join(DATA_DIR, 'agent-batches');
const { items } = readJson(path.join(DATA_DIR, 'inventory.json'));
const vision = readJson(path.join(CACHE_DIR, 'vision', 'index.json'));

const toImage = (it) => ({
  id: it.id,
  file: it.file,
  kind: it.kind,
  batch: it.batch,
  visionFiles: vision[it.id],
  ...(it.kind === 'jpeg' ? { filenameCompany: it.company, filenameCategory: it.category, filenameCategoryRaw: it.fileCategory } : {}),
  ...(it.kind === 'webp' ? { nn: it.nn, headlineSlug: it.headlineSlug, isCopy: it.isCopy } : {}),
  ...(it.kind === 'png' ? { companyHint: it.companyHint } : {}),
  measured: { darkFraction: it.darkFraction, luminance: it.luminance, colorfulness: it.colorfulness, ratio: it.ratio },
  nearDuplicates: it.nearDuplicates.map((d) => d.id),
});

// Group into units that must stay together.
const units = new Map();
for (const it of items) {
  const key = it.batch;
  if (!units.has(key)) units.set(key, { key, kind: it.kind === 'jpeg' ? 'jpeg' : 'webp', images: [] });
  units.get(key).images.push(toImage(it));
}
for (const u of units.values()) u.images.sort((a, b) => (a.nn ?? 0) - (b.nn ?? 0) || a.file.localeCompare(b.file));

function pack(list, prefix) {
  const tasks = [];
  let cur = null;
  for (const u of list) {
    if (!cur || cur.images.length + u.images.length > TARGET) {
      cur = { taskId: `${prefix}${String(tasks.length + 1).padStart(2, '0')}`, kind: prefix === 'J' ? 'jpeg' : 'webp', batches: [], images: [] };
      tasks.push(cur);
    }
    cur.batches.push(u.key);
    cur.images.push(...u.images);
  }
  return tasks;
}

const jpegUnits = [...units.values()].filter((u) => u.kind === 'jpeg').sort((a, b) => a.key.localeCompare(b.key));
// WebP batches stay in capture order so neighbouring singletons share a task.
const webpUnits = [...units.values()].filter((u) => u.kind === 'webp').sort((a, b) => a.key.localeCompare(b.key));
const tasks = [...pack(jpegUnits, 'J'), ...pack(webpUnits, 'W')];

for (const t of tasks) writeJson(path.join(OUT, 'tasks', `${t.taskId}.json`), t);

const knownCompanies = [...new Set(items.filter((it) => it.kind === 'jpeg').map((it) => it.company))].sort();
writeJson(path.join(OUT, 'known-companies.json'), knownCompanies);

// Calibration set: ~20 JPEGs spread across categories + whole WebP batches (~20 images).
const byCat = new Map();
for (const it of items.filter((i) => i.kind === 'jpeg')) {
  if (!byCat.has(it.category)) byCat.set(it.category, []);
  byCat.get(it.category).push(it);
}
const calib = [];
for (const list of byCat.values()) calib.push(...list.filter((_, i) => i % 37 === 3).slice(0, 2).map(toImage));
const calibJpeg = calib.slice(0, 22);
const webpPick = ['w010', 'w040', 'w090', 'w120'].map((k) => units.get(k)).filter(Boolean);
const calibWebp = [];
for (const u of webpPick) if (calibWebp.length + u.images.length <= 22) calibWebp.push(...u.images);
writeJson(path.join(OUT, 'tasks', 'CAL.json'), { taskId: 'CAL', kind: 'mixed', batches: ['calibration'], images: [...calibJpeg, ...calibWebp] });

console.log(`${tasks.length} tasks (${tasks.filter((t) => t.kind === 'jpeg').length} jpeg, ${tasks.filter((t) => t.kind === 'webp').length} webp); sizes: ${tasks.map((t) => t.images.length).join(',')}`);
console.log(`Calibration task: ${calibJpeg.length} jpeg + ${calibWebp.length} webp`);
