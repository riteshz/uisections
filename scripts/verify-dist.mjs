// Post-build checks for SEO, structure, links and Cloudflare Pages limits.
// Exits non-zero on errors; prints warnings separately.
import fs from 'node:fs';
import path from 'node:path';
import { SITE_DIR } from './lib/common.mjs';

const DIST = path.join(SITE_DIR, 'dist');
const ORIGIN = 'https://uisections.com';
const errors = [];
const warnings = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);
const warn = (page, msg) => warnings.push(`${page}: ${msg}`);

if (!fs.existsSync(DIST)) { console.error('dist/ missing — run npm run build'); process.exit(1); }

const allFiles = fs.readdirSync(DIST, { recursive: true }).filter((f) => fs.statSync(path.join(DIST, f)).isFile());
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
const exists = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split('#')[0].split('?')[0]);
  const p = path.join(DIST, clean);
  if (clean.endsWith('/')) return fs.existsSync(path.join(p, 'index.html'));
  return fs.existsSync(p) && fs.statSync(p).isFile();
};
const pageUrl = (file) => (file === 'index.html' ? '/' : `/${file.replace(/index\.html$/, '')}`);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const titles = new Map();
const descriptions = new Map();
const indexable = new Set();
let maxHtml = { file: '', bytes: 0 };

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(DIST, file), 'utf8');
  const url = pageUrl(file);
  const is404 = file === '404.html';
  if (html.length > maxHtml.bytes) maxHtml = { file, bytes: html.length };
  if (html.length > 200_000) warn(url, `HTML is ${(html.length / 1024).toFixed(0)} KB`);

  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) err(url, `${h1s} <h1> elements`);

  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  if (!title) err(url, 'missing <title>');
  else if (title.length > 65 || title.length < 20) warn(url, `title length ${title.length}: "${title}"`);
  const desc = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
  if (!desc) err(url, 'missing meta description');
  else if (desc.length > 160 || desc.length < 70) warn(url, `description length ${desc.length}`);

  const noindex = /<meta name="robots" content="noindex/.test(html);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (!is404) {
    if (!canonical) err(url, 'missing canonical');
    else if (canonical !== `${ORIGIN}${url}`) err(url, `canonical ${canonical} ≠ self`);
    if (!noindex) {
      indexable.add(`${ORIGIN}${url}`);
      if (titles.has(title)) err(url, `duplicate title with ${titles.get(title)}`);
      if (descriptions.has(desc)) err(url, `duplicate description with ${descriptions.get(desc)}`);
      titles.set(title, url);
      descriptions.set(desc, url);
    }
  } else if (!noindex) err(url, '404 page should be noindex');

  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (!og) err(url, 'missing og:image');
  else if (!exists(new URL(og).pathname)) err(url, `og:image not found: ${og}`);

  for (const tag of html.match(/<img\b[^>]*>/g) ?? []) {
    if (attr(tag, 'alt') === undefined) err(url, `img without alt: ${tag.slice(0, 90)}`);
    if (!attr(tag, 'width') || !attr(tag, 'height')) err(url, `img without width/height: ${tag.slice(0, 90)}`);
    const src = attr(tag, 'src');
    if (src?.startsWith('/') && !exists(src)) err(url, `img src missing: ${src}`);
  }

  const hrefs = new Set([...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => decode(m[1])));
  for (const href of hrefs) {
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    if (!exists(clean)) err(url, `broken link ${href}`);
    else if (!/\.[a-z0-9]+$/i.test(clean) && !clean.endsWith('/')) err(url, `link without trailing slash ${href}`);
  }
  if (/\b(undefined|NaN)\b|\[object Object\]/.test(html.replace(/<script[\s\S]*?<\/script>/g, ''))) err(url, 'contains undefined/NaN/[object Object]');

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { err(url, `invalid JSON-LD: ${e.message}`); continue; }
    const nodes = data['@graph'] ?? [data];
    for (const n of nodes) {
      if (n['@type'] === 'BreadcrumbList') {
        n.itemListElement.forEach((li, i) => {
          if (li.position !== i + 1) err(url, 'breadcrumb positions not sequential');
          if (!li.item?.startsWith(ORIGIN) || !exists(new URL(li.item).pathname)) err(url, `breadcrumb item missing: ${li.item}`);
        });
      }
      if (n.mainEntity?.itemListElement) {
        for (const li of n.mainEntity.itemListElement) {
          const u = li.item?.contentUrl ?? li.url ?? li.item?.url;
          if (u && u.startsWith(ORIGIN) && !exists(new URL(u).pathname)) err(url, `ItemList URL missing: ${u}`);
        }
      }
    }
  }
}

// Sitemap must list exactly the indexable pages.
const sitemapUrls = new Set();
for (const f of allFiles.filter((f) => /^sitemap-\d+\.xml$/.test(f))) {
  for (const m of fs.readFileSync(path.join(DIST, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) sitemapUrls.add(m[1]);
}
if (!sitemapUrls.size) err('sitemap', 'no sitemap URLs found');
for (const u of indexable) if (!sitemapUrls.has(u)) err('sitemap', `indexable page missing: ${u}`);
for (const u of sitemapUrls) if (!indexable.has(u)) err('sitemap', `non-indexable or missing page listed: ${u}`);

if (!fs.existsSync(path.join(DIST, '404.html'))) err('dist', 'missing top-level 404.html');
if (!fs.existsSync(path.join(DIST, '_headers'))) err('dist', 'missing _headers');
if (!fs.existsSync(path.join(DIST, 'robots.txt'))) err('dist', 'missing robots.txt');

// Cloudflare Pages limits.
let total = 0, biggest = { f: '', b: 0 };
for (const f of allFiles) {
  const b = fs.statSync(path.join(DIST, f)).size;
  total += b;
  if (b > biggest.b) biggest = { f, b };
}
if (allFiles.length >= 20000) err('dist', `${allFiles.length} files (Pages free limit 20,000)`);
if (biggest.b > 25 * 1024 * 1024) err('dist', `${biggest.f} is over 25 MiB`);

console.log(`Pages: ${htmlFiles.length} (${indexable.size} indexable, sitemap ${sitemapUrls.size}) | files ${allFiles.length} | ${(total / 1048576).toFixed(1)} MB | largest ${biggest.f} ${(biggest.b / 1024).toFixed(0)} KB | largest HTML ${maxHtml.file} ${(maxHtml.bytes / 1024).toFixed(0)} KB`);
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n  ${warnings.slice(0, 40).join('\n  ')}${warnings.length > 40 ? `\n  … ${warnings.length - 40} more` : ''}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s):\n  ${errors.slice(0, 60).join('\n  ')}${errors.length > 60 ? `\n  … ${errors.length - 60} more` : ''}`);
  process.exit(1);
}
console.log('\n✓ dist verified');
