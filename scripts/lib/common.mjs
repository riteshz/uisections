import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Original screenshots live one level above the site folder and are never modified. */
export const SRC_DIR = path.resolve(SITE_DIR, '..');
export const DATA_DIR = path.join(SITE_DIR, 'data');
export const CACHE_DIR = path.join(SITE_DIR, '.cache');
export const PUBLIC_DIR = path.join(SITE_DIR, 'public');
export const GEN_DIR = path.join(SITE_DIR, 'src', 'data');

export const IMAGE_EXT = /\.(jpe?g|webp|png)$/i;

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Run async fn over items with bounded concurrency, logging progress. */
export async function mapLimit(items, limit, fn, label = 'items') {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      done++;
      if (done % 100 === 0 || done === items.length) console.log(`  ${done}/${items.length} ${label}`);
    }
  });
  await Promise.all(workers);
  return results;
}
