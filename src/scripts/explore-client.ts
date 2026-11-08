// Browser helpers shared by the Explore feed (homepage) and the filter dialog:
// loading /explore.json once, matching a filter selection, and building cards that
// match SectionCard.astro exactly (the lightbox and masonry treat both the same).
import type { ExploreData } from '../lib/explore';

export type Facet = 'type' | 'style' | 'industry' | 'company';
export type Selection = Record<Facet, Set<string>>;
export type Record_ = ExploreData['sections'][number];

export const FACETS: Facet[] = ['type', 'style', 'industry', 'company'];
const MIN_RATIO = 0.3;

let pending: Promise<ExploreData> | null = null;
export const loadExplore = () => (pending ??= fetch('/explore.json').then((r) => r.json() as Promise<ExploreData>));

export const emptySelection = (): Selection => ({ type: new Set(), style: new Set(), industry: new Set(), company: new Set() });
export const selectionSize = (sel: Selection) => FACETS.reduce((n, f) => n + sel[f].size, 0);

export function readSelection(params: URLSearchParams): Selection {
  const sel = emptySelection();
  for (const f of FACETS) for (const v of (params.get(f) ?? '').split(',').filter(Boolean)) sel[f].add(v);
  return sel;
}

export function selectionParams(sel: Selection): string {
  const params = new URLSearchParams();
  for (const f of FACETS) if (sel[f].size) params.set(f, [...sel[f]].join(','));
  return params.toString().replace(/%2C/g, ',');
}

/** Options within a group are alternatives (Hero or Pricing); every selected style must apply. */
export function matcher(data: ExploreData, sel: Selection) {
  return (r: Record_) => {
    if (sel.type.size && !sel.type.has(r.t)) return false;
    for (const s of sel.style) if (!r.g.includes(s)) return false;
    if (sel.company.size && !sel.company.has(r.c)) return false;
    if (sel.industry.size && !(data.companies[r.c]?.i ?? []).some((i) => sel.industry.has(i))) return false;
    return true;
  };
}

/** A card element identical to SectionCard.astro's markup. */
export function cardElement(data: ExploreData, r: Record_, typeLabels: Map<string, string>): HTMLLIElement {
  const co = data.companies[r.c];
  const name = co?.n ?? r.c;
  const natural = r.mh / r.mw;
  const li = document.createElement('li');
  li.className = 'card';
  li.id = `s-${r.id}`;
  Object.assign(li.dataset, { id: r.id, cat: r.t, tags: r.g.join(' '), company: r.c, companyName: name });
  if (co?.p) li.dataset.companyHref = co.p;
  if (co?.k) li.dataset.companyCount = String(co.k);
  if (co?.d) li.dataset.domain = co.d;
  li.style.setProperty('--r', Math.max(natural, MIN_RATIO).toFixed(4));
  li.style.setProperty('--shot-bg', r.b);

  const a = document.createElement('a');
  a.className = 'thumb shot';
  a.href = `/shots/${r.l}`;
  a.setAttribute('data-lightbox', '');
  Object.assign(a.dataset, { w: String(r.w), h: String(r.h), thumb: `/shots/${r.m}`, md: `/shots/${r.d}` });
  if (r.hl) a.dataset.headline = r.hl;
  a.setAttribute('aria-label', `Open ${name} ${(typeLabels.get(r.t) ?? 'website').toLowerCase()} section`);

  const img = document.createElement('img');
  img.className = natural < MIN_RATIO ? 'contain' : 'cover';
  img.src = `/shots/${r.m}`;
  img.srcset = `/shots/${r.m} ${r.mw}w, /shots/${r.d} ${r.dw}w`;
  img.sizes = '(min-width: 1100px) 25vw, (min-width: 720px) 33vw, 50vw';
  img.width = r.mw;
  img.height = r.mh;
  img.alt = r.a;
  img.loading = 'lazy';
  img.decoding = 'async';
  a.append(img);
  li.append(a);
  return li;
}

/** Re-runs the masonry layout (defined inline in BaseLayout). */
export const relayout = (grid: Element | null) => (window as unknown as { uiMasonry?: (g: Element | null) => void }).uiMasonry?.(grid);
