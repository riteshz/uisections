// Small JPEG copies for the AI tagging agents (cheap to read, legible text).
// Very tall sections are split into vertical tiles so nothing gets squashed.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SRC_DIR, DATA_DIR, CACHE_DIR, readJson, writeJson, mapLimit } from './lib/common.mjs';

const MAX_W = 960;
const TILE_H = 1800;
const OUT = path.join(CACHE_DIR, 'vision');
fs.mkdirSync(OUT, { recursive: true });

const { items } = readJson(path.join(DATA_DIR, 'inventory.json'));
const index = {};

await mapLimit(items, 6, async (it) => {
  const w = Math.min(MAX_W, it.width);
  const tiles = Math.max(1, Math.ceil(Math.round((it.height * w) / it.width) / TILE_H));
  const names = tiles === 1 ? [`${it.id}.jpg`] : Array.from({ length: tiles }, (_, i) => `${it.id}-${i + 1}.jpg`);
  index[it.id] = names.map((n) => path.join(OUT, n));
  if (names.every((n) => fs.existsSync(path.join(OUT, n)))) return;
  const { data: resized, info } = await sharp(path.join(SRC_DIR, it.file)).resize({ width: w }).toBuffer({ resolveWithObject: true });
  const h = info.height;
  for (let i = 0; i < tiles; i++) {
    const top = i * TILE_H;
    const height = Math.min(TILE_H, h - top);
    await sharp(resized).extract({ left: 0, top, width: w, height }).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(OUT, names[i]));
  }
}, 'vision copies');

writeJson(path.join(OUT, 'index.json'), index);
const tiled = Object.values(index).filter((v) => v.length > 1).length;
console.log(`Vision copies ready in ${OUT} (${tiled} images tiled)`);
