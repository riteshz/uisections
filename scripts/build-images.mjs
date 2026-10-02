// Encodes web derivatives once into .cache (keyed by content hash + encoder
// version), then hardlinks them into public/shots under SEO-friendly names
// taken from src/data/sections.json (when it exists).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SRC_DIR, DATA_DIR, CACHE_DIR, PUBLIC_DIR, GEN_DIR, readJson, writeJson, mapLimit } from './lib/common.mjs';

const ENCODER_VERSION = 'v1';
/** Card frame is 16:10; taller screenshots are cropped from the top. */
export const FRAME_RATIO = 0.625;
const THUMB_WIDTHS = [480, 960];
const LARGE_WIDTH = 1600;
/** Full-height, mobile-friendly width for company pages and the lightbox on phones. */
const MEDIUM_WIDTH = 1080;

const CACHE = path.join(CACHE_DIR, 'shots', ENCODER_VERSION);
const MANIFEST = path.join(CACHE, 'manifest.json');
fs.mkdirSync(CACHE, { recursive: true });

const { items } = readJson(path.join(DATA_DIR, 'inventory.json'));
const manifest = readJson(MANIFEST, {});

async function encode(it) {
  const src = path.join(SRC_DIR, it.file);
  const out = (suffix) => path.join(CACHE, `${it.id}-${suffix}.webp`);
  const entry = manifest[it.id] ?? {};
  const has = (key, suffix) => entry[key] && fs.existsSync(out(suffix));

  // Thumbnails: crop the top of tall sections to the card frame.
  const cropH = it.ratio > FRAME_RATIO ? Math.round(it.width * FRAME_RATIO) : it.height;
  for (const w of THUMB_WIDTHS) {
    if (has(`t${w}`, w)) continue;
    const info = await sharp(src)
      .extract({ left: 0, top: 0, width: it.width, height: cropH })
      .resize({ width: Math.min(w, it.width) })
      .webp({ quality: 80, effort: 5, smartSubsample: true })
      .toFile(out(w));
    entry[`t${w}`] = { w: info.width, h: info.height, bytes: info.size };
  }

  // Large (lightbox): full height. Small WebP originals are already web-ready.
  if (!has('lg', 'lg')) {
    if (it.kind === 'webp' && it.width <= LARGE_WIDTH) {
      fs.copyFileSync(src, out('lg'));
      entry.lg = { w: it.width, h: it.height, bytes: it.bytes };
    } else {
      const info = await sharp(src)
        .resize({ width: Math.min(LARGE_WIDTH, it.width) })
        .webp({ quality: 78, effort: 5, smartSubsample: true })
        .toFile(out('lg'));
      entry.lg = { w: info.width, h: info.height, bytes: info.size };
    }
  }

  // Medium: full height at phone-friendly width.
  if (!has('md', 'md')) {
    const info = await sharp(src)
      .resize({ width: Math.min(MEDIUM_WIDTH, it.width) })
      .webp({ quality: 78, effort: 5, smartSubsample: true })
      .toFile(out('md'));
    entry.md = { w: info.width, h: info.height, bytes: info.size };
  }
  manifest[it.id] = entry;
}

console.log(`Encoding derivatives for ${items.length} images → ${CACHE}`);
await mapLimit(items, 4, encode, 'encoded');
writeJson(MANIFEST, manifest);

// --- Publish: hardlink into public/shots using names from merged data -------
const sectionsFile = path.join(GEN_DIR, 'sections.json');
if (!fs.existsSync(sectionsFile)) {
  console.log('No src/data/sections.json yet — skipping publish step (run `npm run data` first).');
} else {
  const sections = readJson(sectionsFile);
  const shotsDir = path.join(PUBLIC_DIR, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const expected = new Set();
  for (const s of sections) {
    for (const [suffix, name] of Object.entries(s.files)) {
      const target = path.join(shotsDir, name);
      expected.add(name);
      const source = path.join(CACHE, `${s.id}-${suffix}.webp`);
      if (fs.existsSync(target)) {
        if (fs.statSync(target).ino === fs.statSync(source).ino) continue;
        fs.unlinkSync(target);
      }
      fs.linkSync(source, target);
    }
  }
  let removed = 0;
  for (const f of fs.readdirSync(shotsDir)) if (!expected.has(f)) { fs.unlinkSync(path.join(shotsDir, f)); removed++; }
  const bytes = [...expected].reduce((sum, f) => sum + fs.statSync(path.join(shotsDir, f)).size, 0);
  console.log(`Published ${expected.size} files to public/shots (${(bytes / 1048576).toFixed(1)} MB), removed ${removed} stale`);
}
