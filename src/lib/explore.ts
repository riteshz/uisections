// The Explore feed (homepage): every section, newest first, spread so the same company
// never sits in neighbouring slots. The homepage renders the first page; the rest, and
// all filtering, come from /explore.json in the same order.
import { allCategories, companies, getCompany, industries, sections, tags, type Section } from './data';

/** Cards rendered in the homepage HTML; later pages load from /explore.json. */
export const EXPLORE_PAGE = 60;

let cached: Section[] | null = null;

export function exploreOrder(): Section[] {
  if (cached) return cached;
  // Stable sort: within a day the curated order (already company-spread) is kept.
  const pool = [...sections].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
  const out: Section[] = [];
  while (pool.length) {
    const recent = new Set(out.slice(-2).map((s) => s.company));
    const i = pool.findIndex((s) => !recent.has(s.company));
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return (cached = out);
}

/** Compact client data: short keys keep /explore.json small. */
export function exploreData() {
  const byCount = <T extends { count: number; label: string }>(a: T, b: T) => b.count - a.count || a.label.localeCompare(b.label);
  const usedCompanies = new Set(sections.map((s) => s.company));
  return {
    v: 1,
    sections: exploreOrder().map((s) => ({
      id: s.id,
      c: s.company,
      t: s.category,
      g: s.tags,
      m: s.files.m480,
      mw: s.masonry.w,
      mh: s.masonry.h,
      d: s.files.md,
      dw: s.medium.w,
      l: s.files.lg,
      w: s.large.w,
      h: s.large.h,
      b: s.bg,
      hl: s.headline,
      a: s.alt,
    })),
    companies: Object.fromEntries(
      companies
        .filter((c) => usedCompanies.has(c.slug))
        .map((c) => {
          const co = getCompany(c.slug)!;
          return [c.slug, { n: co.name, d: co.domain, i: co.industries, p: co.hasPage ? `/companies/${co.slug}/` : null, k: co.count }];
        }),
    ),
    facets: {
      type: allCategories
        .filter((c) => c.count > 0 && c.id !== 'other')
        .map((c) => ({ id: c.id, label: c.label, count: c.count }))
        .sort(byCount),
      style: tags.filter((t) => t.count > 0).map((t) => ({ id: t.id, label: t.label, count: t.count })).sort(byCount),
      industry: industries.filter((i) => i.count > 0).map((i) => ({ id: i.id, label: i.label, count: i.count })).sort(byCount),
      company: companies
        .filter((c) => c.slug !== 'unknown' && c.count > 0)
        .map((c) => ({ id: c.slug, label: c.name, count: c.count }))
        .sort(byCount),
    },
  };
}

export type ExploreData = ReturnType<typeof exploreData>;
