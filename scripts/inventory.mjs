// Scans the original screenshots (the Sections folder and its image
// subfolders such as new/), derives deterministic facts and freezes WebP
// capture batches. Incremental: ids are content hashes, already-catalogued
// screenshots are kept even if their original file has since been moved
// (their web derivatives are cached), and only new files are analysed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { SITE_DIR, SRC_DIR, DATA_DIR, IMAGE_EXT, readJson, writeJson, mapLimit, slugify } from './lib/common.mjs';

const categories = readJson(path.join(DATA_DIR, 'vocab', 'categories.json'));
const filenameCategory = new Map();
for (const c of categories) for (const f of c.fromFilename) filenameCategory.set(f, c.id);
// Longest first so "pricing-table" wins over "pricing".
const fileCats = [...filenameCategory.keys()].sort((a, b) => b.length - a.length);
const JPEG_RE = new RegExp(`^(.+)-(${fileCats.join('|')})-section(?:-(\\d+|[0-9a-f]{5}))?\\.jpe?g$`);
const WEBP_RE = /^(\d+)-(.+?)((?: copy(?: \d+)?)|(?: \(\d+\)))?\.webp$/;

const BATCH_GAP_MS = 3000;

function parseName(filePath) {
  const file = path.basename(filePath);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpeg' || ext === '.jpg') {
    const m = file.match(JPEG_RE);
    if (!m) throw new Error(`Unparseable JPEG name: ${file}`);
    return {
      kind: 'jpeg',
      company: m[1],
      fileCategory: m[2],
      category: filenameCategory.get(m[2]),
      variant: m[3] ?? null,
    };
  }
  if (ext === '.webp') {
    const m = file.match(WEBP_RE);
    if (!m) throw new Error(`Unparseable WebP name: ${file}`);
    return { kind: 'webp', nn: Number(m[1]), headlineSlug: m[2], isCopy: Boolean(m[3]) };
  }
  // Single PNG (operate.so_.png): the filename is the only hint.
  return { kind: 'png', companyHint: file.replace(/_?\.png$/i, '') };
}

async function analyse(file) {
  const abs = path.join(SRC_DIR, file);
  const buf = fs.readFileSync(abs);
  const stat = fs.statSync(abs);
  const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
  const meta = await sharp(buf).metadata();

  const { data } = await sharp(buf).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let lum = 0, dark = 0;
  let sRg = 0, sYb = 0, sRg2 = 0, sYb2 = 0;
  const buckets = new Map();
  const n = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lum += y;
    if (y < 0.2) dark++;
    const rg = r - g, yb = 0.5 * (r + g) - b;
    sRg += rg; sYb += yb; sRg2 += rg * rg; sYb2 += yb * yb;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { c: 0, r: 0, g: 0, b: 0 };
    e.c++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const mRg = sRg / n, mYb = sYb / n;
  const colorfulness = Math.sqrt(Math.max(0, sRg2 / n - mRg * mRg) + Math.max(0, sYb2 / n - mYb * mYb)) + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb);
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  const dominantColors = [...buckets.values()]
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .map((e) => ({ hex: `#${hex(e.r / e.c)}${hex(e.g / e.c)}${hex(e.b / e.c)}`, share: +(e.c / n).toFixed(3) }));

  const gray = await sharp(buf).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let dhash = 0n;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    dhash = (dhash << 1n) | (gray[row * 9 + col] > gray[row * 9 + col + 1] ? 1n : 0n);
  }

  return {
    id,
    file,
    ...parseName(file),
    width: meta.width,
    height: meta.height,
    ratio: +(meta.height / meta.width).toFixed(4),
    bytes: buf.length,
    mtimeMs: Math.floor(stat.mtimeMs),
    addedAt: new Date(stat.mtimeMs).toISOString(),
    luminance: +(lum / n).toFixed(3),
    darkFraction: +(dark / n).toFixed(3),
    colorfulness: +colorfulness.toFixed(1),
    dominantColors,
    dhash: dhash.toString(16).padStart(16, '0'),
  };
}

function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

/** Image files in the Sections folder and its subfolders (never the site itself), as paths relative to SRC_DIR. */
function listSources() {
  const out = [];
  for (const entry of fs.readdirSync(SRC_DIR, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && IMAGE_EXT.test(entry.name)) out.push(entry.name);
    else if (entry.isDirectory() && path.join(SRC_DIR, entry.name) !== SITE_DIR) {
      for (const f of fs.readdirSync(path.join(SRC_DIR, entry.name))) {
        const rel = path.join(entry.name, f);
        if (IMAGE_EXT.test(f) && fs.statSync(path.join(SRC_DIR, rel)).isFile()) out.push(rel);
      }
    }
  }
  return out.sort();
}

const previous = readJson(path.join(DATA_DIR, 'inventory.json'), { items: [], exactDuplicates: [] });
const known = new Map(previous.items.map((it) => [it.id, it]));
const exactDuplicates = [...(previous.exactDuplicates ?? [])];

const files = listSources();
console.log(`Scanning ${files.length} images under ${SRC_DIR} (${known.size} already catalogued)`);
const hashed = await mapLimit(files, 8, async (file) => ({
  file,
  id: crypto.createHash('sha256').update(fs.readFileSync(path.join(SRC_DIR, file))).digest('hex').slice(0, 10),
}), 'hashed');

const seenNow = new Map();
const freshFiles = [];
for (const { file, id } of hashed) {
  if (seenNow.has(id)) {
    if (!exactDuplicates.some((d) => d.file === file)) exactDuplicates.push({ id, file, sameAs: seenNow.get(id) });
    continue;
  }
  seenNow.set(id, file);
  if (known.has(id)) known.get(id).file = file; // follow the file if it moved within the folder
  else freshFiles.push(file);
}
const fresh = await mapLimit(freshFiles, 8, analyse, 'analysed');
for (const it of known.values()) it.sourceMissing = !seenNow.has(it.id) || undefined;
for (const it of fresh) it.nearDuplicates = [];

const unique = [...known.values(), ...fresh];

// Near-duplicate candidates for new screenshots (confirmed visually during tagging).
for (const a of fresh) for (const b of unique) {
  if (a === b || a.nearDuplicates.some((d) => d.id === b.id)) continue;
  const d = hamming(a.dhash, b.dhash);
  if (d <= 4) {
    a.nearDuplicates.push({ id: b.id, distance: d });
    if (!b.nearDuplicates.some((x) => x.id === a.id)) b.nearDuplicates.push({ id: a.id, distance: d });
  }
}

// --- Batches -------------------------------------------------------------
// WebP captures: frozen once, because mtimes are lost if the folder is copied.
const batchesFile = path.join(DATA_DIR, 'batches.json');
const frozen = readJson(batchesFile, { webp: [] });
const assigned = new Map();
for (const b of frozen.webp) for (const id of b.members) assigned.set(id, b.id);

const freshWebp = unique.filter((it) => it.kind === 'webp' && !assigned.has(it.id)).sort((a, b) => a.mtimeMs - b.mtimeMs || a.nn - b.nn || a.file.localeCompare(b.file));
let counter = frozen.webp.length;
let current = null;
let prev = null;
for (const it of freshWebp) {
  const sameSecond = prev && Math.floor(prev.mtimeMs / 1000) === Math.floor(it.mtimeMs / 1000);
  const gap = prev ? it.mtimeMs - prev.mtimeMs : Infinity;
  const nnReset = prev && !sameSecond && it.nn <= prev.nn;
  if (!current || gap > BATCH_GAP_MS || nnReset) {
    current = { id: `w${String(++counter).padStart(3, '0')}`, members: [] };
    frozen.webp.push(current);
  }
  current.members.push(it.id);
  assigned.set(it.id, current.id);
  prev = it;
}
writeJson(batchesFile, frozen);

for (const it of unique) {
  if (it.kind === 'webp') it.batch = assigned.get(it.id);
  else if (it.kind === 'jpeg') it.batch = `co-${it.company}`;
  else it.batch = `png-${slugify(it.companyHint)}`;
}

unique.sort((a, b) => a.batch.localeCompare(b.batch) || (a.nn ?? 0) - (b.nn ?? 0) || a.file.localeCompare(b.file));
writeJson(path.join(DATA_DIR, 'inventory.json'), { generatedAt: new Date().toISOString(), count: unique.length, exactDuplicates, items: unique });

const kinds = unique.reduce((m, it) => ((m[it.kind] = (m[it.kind] ?? 0) + 1), m), {});
const withNear = unique.filter((it) => it.nearDuplicates.length).length;
const missing = unique.filter((it) => it.sourceMissing).length;
console.log(`Inventory: ${unique.length} unique images (${fresh.length} new, ${missing} with originals moved elsewhere)`, kinds, `| exact dups ${exactDuplicates.length} | near-dup candidates ${withNear} | webp batches ${frozen.webp.length}`);
