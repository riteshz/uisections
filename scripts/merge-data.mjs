// Merges inventory + AI tags + human overrides into the site's generated data.
// Precedence: inventory (filename facts) < AI passes < data/overrides.json.
// Fails loudly on vocabulary violations so bad data never reaches the build.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DATA_DIR, GEN_DIR, CACHE_DIR, readJson, writeJson, slugify } from './lib/common.mjs';

const SITE_URL = 'https://uisections.com';
const CATEGORY_MIN = 8; // smaller categories are folded into their parent
const TAG_PAGE_MIN = 8;
const TAG_INDEX_MIN = 12;
const COMPANY_PAGE_MIN = 2;
const COMPANY_INDEX_MIN = 3;
// A 397-card listing measured Lighthouse mobile performance 96 (CLS 0, TBT 0).
const LISTING_WARN = 450;
// Section types left out of the site entirely (with their screenshots).
const EXCLUDED_CATEGORIES = new Set(['divider']);
const FOLD = { careers: 'team', 'value-proposition': 'feature', stats: 'feature', newsletter: 'cta', security: 'feature', 'use-case': 'feature', navbar: 'hero', comparison: 'pricing' };

const categoriesVocab = readJson(path.join(DATA_DIR, 'vocab', 'categories.json'));
const tagsVocab = readJson(path.join(DATA_DIR, 'vocab', 'tags.json'));
const CAT_IDS = categoriesVocab.map((c) => c.id);
const TAG_IDS = tagsVocab.map((t) => t.id);
const tagById = new Map(tagsVocab.map((t) => [t.id, t]));

const { items } = readJson(path.join(DATA_DIR, 'inventory.json'));
const manifest = readJson(path.join(CACHE_DIR, 'shots', 'v1', 'manifest.json'));
const overrides = readJson(path.join(DATA_DIR, 'overrides.json'), { sections: {}, companies: {} });
const companyMeta = readJson(path.join(DATA_DIR, 'companies.json'), {});
const publishedSlugs = readJson(path.join(DATA_DIR, 'published-slugs.json'), {});

// --- AI records -----------------------------------------------------------
const Conf = z.enum(['high', 'medium', 'low']);
const AiRecord = z.object({
  id: z.string(),
  companyName: z.string(),
  companySlug: z.string(),
  domain: z.string().nullable().optional(),
  companyConfidence: Conf,
  category: z.enum(CAT_IDS),
  categoryConfidence: Conf,
  categoryAlternates: z.array(z.enum(CAT_IDS)).default([]),
  filenameDisagree: z.boolean().default(false),
  tags: z.array(z.object({ id: z.enum(TAG_IDS), confidence: z.enum(['high', 'medium']) })),
  headline: z.string(),
  alt: z.string(),
  usable: z.boolean(),
  issues: z.array(z.string()).default([]),
  duplicateOf: z.string().nullable().optional(),
  source: z.string().optional(),
});

/** data/tags/*.json files are arrays of records; later files (sorted) win. */
const ai = new Map();
const tagsDir = path.join(DATA_DIR, 'tags');
if (fs.existsSync(tagsDir)) {
  const files = fs.readdirSync(tagsDir, { recursive: true }).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const records = readJson(path.join(tagsDir, f));
    for (const raw of records) {
      const parsed = AiRecord.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid AI record in ${f} (${raw.id}): ${parsed.error.message}`);
      ai.set(parsed.data.id, { ...ai.get(parsed.data.id), ...parsed.data, source: f });
    }
  }
}

// --- Helpers ----------------------------------------------------------------
const titleCase = (slug) => slug.split('-').map((w) => (w.length <= 2 && /\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
const PAGE_ORDER = ['navbar', 'hero', 'logo-cloud', 'value-proposition', 'feature', 'how-it-works', 'use-case', 'stats', 'integration', 'security', 'testimonial', 'comparison', 'pricing', 'team', 'careers', 'about', 'blog', 'faq', 'contact', 'newsletter', 'divider', 'cta', 'footer', 'other'];

function heuristicTags(it) {
  const tags = [];
  if (it.darkFraction >= 0.6) tags.push('dark-mode');
  if (it.colorfulness < 8 && it.darkFraction < 0.6) tags.push('monochrome');
  return tags;
}

const review = [];
const flag = (it, reason, extra = '') => review.push({ id: it.id, file: it.file, reason, extra });

// --- Build section records --------------------------------------------------
const sections = [];
const dropped = [];
for (const it of items) {
  const rec = ai.get(it.id);
  const ov = overrides.sections[it.id] ?? {};
  if (ov.exclude) { dropped.push({ id: it.id, file: it.file, reason: ov.exclude }); continue; }

  if (!rec && it.kind !== 'jpeg') { dropped.push({ id: it.id, file: it.file, reason: 'untagged-webp' }); continue; }

  let company = it.kind === 'jpeg' ? it.company : slugify(rec.companySlug || 'unknown') || 'unknown';
  let category = it.kind === 'jpeg' ? it.category : rec.category;
  let tags = rec ? rec.tags.map((t) => t.id) : heuristicTags(it);
  let headline = rec?.headline ?? it.headlineSlug?.replace(/-/g, ' ') ?? '';
  let alt = rec?.alt ?? '';

  if (rec) {
    if (!rec.usable) { dropped.push({ id: it.id, file: it.file, reason: `unusable: ${rec.issues.join(', ')}` }); continue; }
    if (rec.duplicateOf && rec.duplicateOf !== it.id) { dropped.push({ id: it.id, file: it.file, reason: `duplicate of ${rec.duplicateOf}` }); continue; }
    if (it.kind !== 'jpeg' && (rec.companyConfidence === 'low' || company === 'unknown')) flag(it, 'company-low-confidence', rec.companyName);
    if (rec.categoryConfidence === 'low') flag(it, 'category-low-confidence', rec.category);
    if (rec.filenameDisagree) flag(it, 'filename-category-disagree', `${it.category} → ${rec.categoryAlternates[0] ?? '?'}`);
    const saysDark = tags.includes('dark-mode');
    if (saysDark && it.darkFraction < 0.35) flag(it, 'dark-mode-vs-luminance', `darkFraction ${it.darkFraction}`);
    if (!saysDark && it.darkFraction > 0.85) flag(it, 'missing-dark-mode', `darkFraction ${it.darkFraction}`);
  }

  if (ov.company) company = ov.company;
  if (ov.category) category = ov.category;
  if (ov.addTags) tags = [...new Set([...tags, ...ov.addTags])];
  if (ov.removeTags) tags = tags.filter((t) => !ov.removeTags.includes(t));
  if (ov.headline) headline = ov.headline;
  if (ov.alt) alt = ov.alt;

  for (const t of tags) if (!tagById.has(t)) throw new Error(`Unknown tag "${t}" on ${it.id}`);
  // Enforce exclusions: keep the first-listed tag of a conflicting pair.
  tags = tags.filter((t, i) => !tags.slice(0, i).some((prev) => tagById.get(prev).excludes.includes(t)));
  if (!CAT_IDS.includes(category)) throw new Error(`Unknown category "${category}" on ${it.id}`);
  if (EXCLUDED_CATEGORIES.has(category)) { dropped.push({ id: it.id, file: it.file, reason: `excluded section type: ${category}` }); continue; }

  const m = manifest[it.id];
  if (!m) throw new Error(`No encoded derivatives for ${it.id} — run npm run images`);

  sections.push({
    id: it.id,
    kind: it.kind,
    company,
    companyName: rec?.companyName,
    companyDomain: rec?.domain ?? null,
    companyConfidence: it.kind === 'jpeg' ? 'high' : rec?.companyConfidence,
    category,
    tags,
    headline: headline.trim(),
    alt: alt.trim(),
    addedAt: it.addedAt,
    nn: it.nn ?? null,
    variant: it.variant ?? null,
    width: it.width,
    height: it.height,
    ratio: it.ratio,
    bg: it.dominantColors[0]?.hex ?? '#f1f1f0',
    dark: it.darkFraction >= 0.6,
    thumb: m.t480,
    thumb2x: m.t960,
    large: m.lg,
    medium: m.md,
  });
}

// Fold categories that are too small to deserve a page.
const catCount = (id) => sections.filter((s) => s.category === id).length;
for (const [from, to] of Object.entries(FOLD)) {
  const n = catCount(from);
  if (n > 0 && n < CATEGORY_MIN) {
    for (const s of sections) if (s.category === from) s.category = to;
    console.log(`  folded ${from} (${n}) → ${to}`);
  }
}
for (const s of sections) if (s.category === 'other') flag(s, 'category-other');

// --- Companies ----------------------------------------------------------------
const companies = new Map();
for (const s of sections) {
  if (!companies.has(s.company)) companies.set(s.company, { slug: s.company, names: new Map(), domains: new Map(), sections: [] });
  const c = companies.get(s.company);
  c.sections.push(s);
  if (s.companyName && s.companyName !== 'Unknown') c.names.set(s.companyName, (c.names.get(s.companyName) ?? 0) + 1);
  if (s.companyDomain) c.domains.set(s.companyDomain, (c.domains.get(s.companyDomain) ?? 0) + 1);
}
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const companyList = [];
for (const c of companies.values()) {
  const meta = { ...companyMeta[c.slug], ...overrides.companies?.[c.slug] };
  const name = meta.name ?? top(c.names) ?? titleCase(c.slug);
  const unknown = c.slug === 'unknown';
  const count = c.sections.length;
  // Page order: webp nn when known, else canonical section order.
  c.sections.sort((a, b) => (a.nn ?? 999) - (b.nn ?? 999) || PAGE_ORDER.indexOf(a.category) - PAGE_ORDER.indexOf(b.category) || (a.variant ?? '').localeCompare(b.variant ?? ''));
  const tagFreq = new Map();
  for (const s of c.sections) for (const t of s.tags) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
  companyList.push({
    slug: c.slug,
    name,
    domain: meta.domain ?? (meta.verified === false ? null : top(c.domains) ?? null),
    domainVerified: Boolean(meta.domain),
    count,
    hasPage: !unknown && count >= COMPANY_PAGE_MIN,
    indexable: !unknown && count >= COMPANY_INDEX_MIN,
    categories: [...new Set(c.sections.map((s) => s.category))],
    topTags: [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t),
    sectionIds: c.sections.map((s) => s.id),
    cover: (c.sections.find((s) => s.category === 'hero') ?? c.sections[0]).id,
    addedAt: c.sections.map((s) => s.addedAt).sort().at(-1),
  });
}
companyList.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
const companyBySlug = new Map(companyList.map((c) => [c.slug, c]));
for (const s of sections) s.companyName = companyBySlug.get(s.company).name;

// --- File names (frozen once published) ------------------------------------
const catById = new Map(categoriesVocab.map((c) => [c.id, c]));
for (const s of sections) {
  const base = publishedSlugs[s.id] ?? `${s.company === 'unknown' ? 'website' : s.company}-${s.category}-section-${s.id}`;
  s.slug = base;
  s.files = { 480: `${base}-480.webp`, 960: `${base}-960.webp`, md: `${base}-md.webp`, lg: `${base}-lg.webp` };
  if (!s.alt) s.alt = `${s.companyName} ${catById.get(s.category).label.toLowerCase()} section${s.headline ? `: “${s.headline.slice(0, 90)}”` : ''}`;
}

// --- Categories & tags --------------------------------------------------------
// File dates are copy dates, not capture dates, so listings use a stable
// hash-shuffled order that keeps the same company out of neighbouring slots.
const hashNum = (id) => parseInt(id.slice(0, 8), 16);
function curate(list) {
  const pool = [...list].sort((a, b) => hashNum(a.id) - hashNum(b.id));
  const out = [];
  while (pool.length) {
    const recent = new Set(out.slice(-3).map((s) => s.company));
    let i = pool.findIndex((s) => !recent.has(s.company));
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
const categoryList = categoriesVocab
  .map((c) => {
    const list = curate(sections.filter((s) => s.category === c.id));
    return {
      id: c.id,
      label: c.label,
      plural: c.plural,
      path: `/${c.id}-sections/`,
      count: list.length,
      hasPage: c.id !== 'other' && list.length >= CATEGORY_MIN,
      covers: list.slice(0, 2).map((s) => s.id),
      sectionIds: list.map((s) => s.id),
    };
  })
  .filter((c) => c.count > 0);

const tagList = tagsVocab.map((t) => {
  const list = curate(sections.filter((s) => s.tags.includes(t.id)));
  return {
    id: t.id,
    label: t.label,
    facet: t.facet,
    path: `/tags/${t.id}/`,
    count: list.length,
    hasPage: t.page && list.length >= TAG_PAGE_MIN,
    indexable: t.page && list.length >= TAG_INDEX_MIN,
    covers: list.slice(0, 2).map((s) => s.id),
    sectionIds: list.map((s) => s.id),
  };
});
// Near-identical tag pages: noindex the smaller one.
const paged = tagList.filter((t) => t.indexable);
for (let i = 0; i < paged.length; i++) for (let j = i + 1; j < paged.length; j++) {
  const a = new Set(paged[i].sectionIds), b = paged[j].sectionIds;
  const inter = b.filter((x) => a.has(x)).length;
  const jac = inter / (a.size + b.length - inter);
  if (jac > 0.8) {
    const smaller = a.size < b.length ? paged[i] : paged[j];
    smaller.indexable = false;
    console.log(`  noindex ${smaller.id} (Jaccard ${jac.toFixed(2)} with ${smaller === paged[i] ? paged[j].id : paged[i].id})`);
  }
}

for (const list of [...categoryList.filter((c) => c.hasPage), ...tagList.filter((t) => t.hasPage)]) {
  if (list.count > LISTING_WARN) console.warn(`  WARNING: ${list.path} has ${list.count} items (> ${LISTING_WARN}); consider paginate()`);
}

// --- Sitemap meta & search index -------------------------------------------
const byId = new Map(sections.map((s) => [s.id, s]));
const lastmod = (ids) => ids.map((id) => byId.get(id).addedAt).sort().at(-1);
const largeUrl = (id) => `${SITE_URL}/shots/${byId.get(id).files.lg}`;
const sitemapMeta = {};
const allIds = sections.map((s) => s.id);
sitemapMeta[`${SITE_URL}/`] = { lastmod: lastmod(allIds), images: curate(sections).slice(0, 48).map((s) => largeUrl(s.id)), indexable: true };
for (const p of ['/categories/', '/tags/', '/companies/', '/about/']) sitemapMeta[`${SITE_URL}${p}`] = { lastmod: lastmod(allIds), images: [], indexable: true };
for (const c of categoryList.filter((c) => c.hasPage)) sitemapMeta[`${SITE_URL}${c.path}`] = { lastmod: lastmod(c.sectionIds), images: c.sectionIds.map(largeUrl), indexable: true };
for (const t of tagList.filter((t) => t.hasPage)) sitemapMeta[`${SITE_URL}${t.path}`] = { lastmod: lastmod(t.sectionIds), images: t.indexable ? t.sectionIds.map(largeUrl) : [], indexable: t.indexable };
for (const c of companyList.filter((c) => c.hasPage)) sitemapMeta[`${SITE_URL}/companies/${c.slug}/`] = { lastmod: lastmod(c.sectionIds), images: c.indexable ? c.sectionIds.map(largeUrl) : [], indexable: c.indexable };

const searchIndex = [
  ...categoryList.filter((c) => c.hasPage).map((c) => ({ type: 'category', label: c.plural, url: c.path, count: c.count })),
  ...tagList.filter((t) => t.hasPage).map((t) => ({ type: 'style', label: t.label, url: t.path, count: t.count })),
  ...companyList.filter((c) => c.hasPage).map((c) => ({ type: 'company', label: c.name, url: `/companies/${c.slug}/`, count: c.count })),
];

// --- Write ----------------------------------------------------------------------
const slim = sections.map(({ kind, companyDomain, companyConfidence, variant, ...s }) => s);
writeJson(path.join(GEN_DIR, 'sections.json'), curate(slim));
writeJson(path.join(GEN_DIR, 'companies.json'), companyList);
writeJson(path.join(GEN_DIR, 'categories.json'), categoryList);
writeJson(path.join(GEN_DIR, 'tags.json'), tagList);
writeJson(path.join(GEN_DIR, 'search-index.json'), searchIndex);
writeJson(path.join(GEN_DIR, 'sitemap-meta.json'), sitemapMeta);

const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const rows = [['id', 'file', 'reason', 'detail'], ...review.map((r) => [r.id, r.file, r.reason, r.extra]), ...dropped.map((d) => [d.id, d.file, 'excluded', d.reason])];
fs.writeFileSync(path.join(DATA_DIR, 'review.csv'), rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n');

console.log(`Sections ${sections.length} (AI-tagged ${[...ai.keys()].filter((id) => byId.has(id)).length}) | excluded ${dropped.length} | review rows ${review.length}`);
console.log(`Companies ${companyList.length} (pages ${companyList.filter((c) => c.hasPage).length}, indexable ${companyList.filter((c) => c.indexable).length})`);
console.log(`Category pages ${categoryList.filter((c) => c.hasPage).length}: ${categoryList.filter((c) => c.hasPage).map((c) => `${c.id}:${c.count}`).join(' ')}`);
console.log(`Tag pages ${tagList.filter((t) => t.hasPage).length} (indexable ${tagList.filter((t) => t.indexable).length}): ${tagList.filter((t) => t.hasPage).map((t) => `${t.id}:${t.count}`).join(' ')}`);
