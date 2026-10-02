// 1200×630 social preview JPEGs per page: title + count on the left, two
// offset screenshots in a gray well on the right (mirrors CategoryCard).
// Text is drawn as Inter glyph paths (Pango cannot load WOFF fonts).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import opentype from 'opentype.js';
import { SITE_DIR, CACHE_DIR, PUBLIC_DIR, GEN_DIR, readJson, writeJson, mapLimit } from './lib/common.mjs';

const W = 1200, H = 630;
const OUT = path.join(PUBLIC_DIR, 'og');
const SHOTS = path.join(CACHE_DIR, 'shots', 'v1');
const VERSION = 'og-v2';
fs.mkdirSync(OUT, { recursive: true });

const loadFont = (weight) => {
  const buf = fs.readFileSync(path.join(SITE_DIR, 'node_modules/@fontsource/inter/files', `inter-latin-${weight}-normal.woff`));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
};
const semibold = loadFont(600);
const regular = loadFont(400);

function measure(font, text, size, track = 0) {
  let w = 0, prev = null;
  const s = size / font.unitsPerEm;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    if (prev) w += font.getKerningValue(prev, g) * s;
    w += g.advanceWidth * s + track * size;
    prev = g;
  }
  return w;
}
function textPath(font, text, x, y, size, track = 0) {
  let d = '', prev = null;
  const s = size / font.unitsPerEm;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, g) * s;
    d += g.getPath(x, y, size).toPathData(2);
    x += g.advanceWidth * s + track * size;
    prev = g;
  }
  return d;
}
function wrap(font, text, size, maxW, track) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (measure(font, next, size, track) <= maxW || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

const sections = readJson(path.join(GEN_DIR, 'sections.json'));
const companies = readJson(path.join(GEN_DIR, 'companies.json'));
const categories = readJson(path.join(GEN_DIR, 'categories.json'));
const tags = readJson(path.join(GEN_DIR, 'tags.json'));
const industries = readJson(path.join(GEN_DIR, 'industries.json'), []);
const byId = new Map(sections.map((s) => [s.id, s]));
const fmt = (n) => n.toLocaleString('en-US');

const SEO_NAMES = { hero: 'Hero Section', feature: 'Features Section', testimonial: 'Testimonial Section', cta: 'CTA Section', 'logo-cloud': 'Logo Cloud', footer: 'Footer', faq: 'FAQ Section', blog: 'Blog Section', pricing: 'Pricing Section' };

const pages = [];
const latestHeroes = [];
const seen = new Set();
for (const s of sections) if (s.category === 'hero' && !seen.has(s.company)) { seen.add(s.company); latestHeroes.push(s.id); if (latestHeroes.length === 2) break; }
const realCompanies = companies.filter((c) => c.slug !== 'unknown').length;
pages.push({ file: 'default.jpg', title: 'Website section design inspiration', sub: `${fmt(sections.length)} real sections from ${realCompanies} companies`, covers: latestHeroes });
pages.push({ file: 'categories.jpg', title: 'Website section types', sub: `${categories.filter((c) => c.hasPage).length} section types · ${fmt(sections.length)} examples`, covers: categories[0]?.covers ?? latestHeroes });
pages.push({ file: 'tags.jpg', title: 'Website design styles', sub: `${tags.filter((t) => t.hasPage).length} styles · dark mode, bento, gradient and more`, covers: tags.find((t) => t.id === 'dark-mode')?.covers ?? latestHeroes });
pages.push({ file: 'companies.jpg', title: 'Website designs by company', sub: `${realCompanies} companies · ${fmt(sections.length)} sections`, covers: latestHeroes.slice().reverse() });
pages.push({ file: 'industries.jpg', title: 'Website design by industry', sub: `${industries.filter((i) => i.hasPage).length} industries · fintech, AI, developer tools and more`, covers: industries.find((i) => i.hasPage)?.covers ?? latestHeroes });
pages.push({ file: 'about.jpg', title: 'About UI Sections', sub: 'A curated library of real website sections', covers: latestHeroes });
for (const c of categories.filter((c) => c.hasPage)) pages.push({ file: `${c.id}-sections.jpg`, title: `${SEO_NAMES[c.id] ?? c.label + ' Section'} Examples`, sub: `${fmt(c.count)} examples · UI Sections`, covers: c.covers });
for (const t of tags.filter((t) => t.hasPage)) pages.push({ file: `tags-${t.id}.jpg`, title: `${t.label} website sections`, sub: `${fmt(t.count)} examples · UI Sections`, covers: t.covers });
for (const i of industries.filter((i) => i.hasPage)) pages.push({ file: `industries-${i.id}.jpg`, title: `${i.seoName} website design`, sub: `${i.companyCount} companies · ${fmt(i.count)} sections`, covers: i.covers });
for (const c of companies.filter((c) => c.hasPage)) pages.push({ file: `companies-${c.slug}.jpg`, title: `${c.name} website design`, sub: `${c.count} sections · UI Sections`, covers: c.sectionIds.slice(0, 2) });

const rounded = (w, h, r) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}"/></svg>`);
async function shot(id, width) {
  const s = byId.get(id);
  if (!s) return null;
  const h = Math.round(width * 0.625);
  const img = await sharp(path.join(SHOTS, `${id}-960.webp`)).resize(width, h, { fit: 'cover', position: 'top' }).composite([{ input: rounded(width, h, 14), blend: 'dest-in' }]).png().toBuffer();
  return { img, w: width, h };
}

const manifestFile = path.join(CACHE_DIR, 'og-manifest.json');
const manifest = readJson(manifestFile, {});
const versions = {};

async function render(p) {
  const hash = crypto.createHash('sha1').update(JSON.stringify([VERSION, p.title, p.sub, p.covers])).digest('hex').slice(0, 8);
  versions[`/og/${p.file}`] = hash;
  const target = path.join(OUT, p.file);
  if (manifest[p.file] === hash && fs.existsSync(target)) return;

  // Title: up to 3 lines, shrinking to fit.
  let size = 62, lines;
  for (; size >= 44; size -= 4) { lines = wrap(semibold, p.title, size, 520, -0.035); if (lines.length <= 3) break; }
  const lh = size * 1.08;
  const titleTop = 300 - ((lines.length - 1) * lh) / 2;
  const titleD = lines.map((l, i) => textPath(semibold, l, 72, titleTop + i * lh, size, -0.035)).join('');
  const subD = textPath(regular, p.sub, 72, titleTop + (lines.length - 1) * lh + 58, 26, -0.005);
  const brandD = textPath(semibold, 'UI Sections', 118, 106, 26, -0.02);
  const urlD = textPath(regular, 'uisections.com', 72, 566, 22, 0);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect x="636" y="56" width="508" height="518" rx="36" fill="#f0f0f0"/>
    <g transform="translate(72 78) scale(1.125)"><rect width="32" height="32" rx="9" fill="#17181a"/><rect x="7" y="8" width="18" height="5" rx="1.75" fill="#fff"/><rect x="7" y="15" width="18" height="3" rx="1.25" fill="#fff" opacity=".62"/><rect x="7" y="20" width="11" height="3" rx="1.25" fill="#fff" opacity=".38"/></g>
    <path d="${brandD}" fill="#17181a"/>
    <path d="${titleD}" fill="#17181a"/>
    <path d="${subD}" fill="#6f6e68"/>
    <path d="${urlD}" fill="#85847e"/>
    <defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter></defs>
    <rect x="690" y="166" width="418" height="262" rx="16" fill="#000" opacity=".10" filter="url(#soft)"/>
    <rect x="658" y="282" width="418" height="262" rx="16" fill="#000" opacity=".12" filter="url(#soft)"/>
  </svg>`;

  const [back, front] = await Promise.all([shot(p.covers[1] ?? p.covers[0], 430), shot(p.covers[0], 430)]);
  const layers = [];
  if (back) layers.push({ input: back.img, left: 684, top: 150 });
  if (front) layers.push({ input: front.img, left: 652, top: 266 });
  // Clip screenshots to the well.
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const wellMask = Buffer.from(`<svg width="${W}" height="${H}"><rect x="636" y="56" width="508" height="518" rx="36" fill="#fff"/></svg>`);
  const shots = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([...layers, { input: wellMask, blend: 'dest-in' }]).png().toBuffer();
  await sharp(base).composite([{ input: shots }]).jpeg({ quality: 85, mozjpeg: true }).toFile(target);
  manifest[p.file] = hash;
}

await mapLimit(pages, 6, render, 'og images');
writeJson(manifestFile, manifest);
writeJson(path.join(GEN_DIR, 'og.json'), versions);
const expected = new Set(pages.map((p) => p.file));
let removed = 0;
for (const f of fs.readdirSync(OUT)) if (!expected.has(f)) { fs.unlinkSync(path.join(OUT, f)); removed++; }
console.log(`OG images: ${pages.length} (removed ${removed} stale)`);
