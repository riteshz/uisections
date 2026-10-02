import sectionsJson from '../data/sections.json';
import companiesJson from '../data/companies.json';
import categoriesJson from '../data/categories.json';
import tagsJson from '../data/tags.json';
import industriesJson from '../data/industries.json';
import vocabIndustries from '../../data/vocab/industries.json';
import vocabTags from '../../data/vocab/tags.json';
import vocabCategories from '../../data/vocab/categories.json';

export interface Dim { w: number; h: number; bytes: number }
export interface Section {
  id: string;
  company: string;
  companyName: string;
  category: string;
  tags: string[];
  headline: string;
  alt: string;
  addedAt: string;
  nn: number | null;
  width: number;
  height: number;
  ratio: number;
  bg: string;
  dark: boolean;
  thumb: Dim;
  thumb2x: Dim;
  large: Dim;
  medium: Dim;
  slug: string;
  files: { '480': string; '960': string; md: string; lg: string };
}
export interface Company {
  slug: string;
  name: string;
  /** Industry ids, primary first. */
  industries: string[];
  domain: string | null;
  domainVerified: boolean;
  count: number;
  hasPage: boolean;
  indexable: boolean;
  categories: string[];
  topTags: string[];
  sectionIds: string[];
  cover: string;
  addedAt: string;
}
export interface Category {
  id: string;
  label: string;
  plural: string;
  path: string;
  count: number;
  hasPage: boolean;
  covers: string[];
  sectionIds: string[];
}
export interface Tag {
  id: string;
  label: string;
  facet: 'theme' | 'layout' | 'media' | 'treatment' | 'type';
  path: string;
  count: number;
  hasPage: boolean;
  indexable: boolean;
  covers: string[];
  sectionIds: string[];
}

export interface Industry {
  id: string;
  label: string;
  seoName: string;
  path: string;
  /** Sections from companies in this industry. */
  count: number;
  companyCount: number;
  hasPage: boolean;
  indexable: boolean;
  covers: string[];
  companySlugs: string[];
  sectionIds: string[];
}

export const sections = sectionsJson as Section[];
export const companies = companiesJson as Company[];
export const categories = (categoriesJson as Category[]).filter((c) => c.hasPage);
export const allCategories = categoriesJson as Category[];
export const tags = tagsJson as Tag[];
export const pagedTags = tags.filter((t) => t.hasPage);
export const industries = industriesJson as Industry[];
export const pagedIndustries = industries.filter((i) => i.hasPage);
export const industryDefinitions = new Map(vocabIndustries.map((i) => [i.id, i.definition]));

export const tagDefinitions = new Map(vocabTags.map((t) => [t.id, t.definition]));
export const categoryDefinitions = new Map(vocabCategories.map((c) => [c.id, c.definition]));

const sectionById = new Map(sections.map((s) => [s.id, s]));
const companyBySlug = new Map(companies.map((c) => [c.slug, c]));
const categoryById = new Map(allCategories.map((c) => [c.id, c]));
const tagById = new Map(tags.map((t) => [t.id, t]));
const industryById = new Map(industries.map((i) => [i.id, i]));

export const getSection = (id: string) => sectionById.get(id)!;
export const getSections = (ids: string[]) => ids.map((id) => sectionById.get(id)!).filter(Boolean);
export const getCompany = (slug: string) => companyBySlug.get(slug);
export const getCategory = (id: string) => categoryById.get(id);
export const getTag = (id: string) => tagById.get(id);
export const getIndustry = (id: string) => industryById.get(id);

export const FACETS: { id: Tag['facet']; label: string }[] = [
  { id: 'theme', label: 'Color & theme' },
  { id: 'layout', label: 'Layout' },
  { id: 'media', label: 'Visuals' },
  { id: 'treatment', label: 'Treatment' },
  { id: 'type', label: 'Typography' },
];

/** Share of sections carrying each tag, most common first. */
export function tagStats(list: Section[], limit = 8) {
  const counts = new Map<string, number>();
  for (const s of list) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, n]) => ({ tag: getTag(id)!, n, share: n / Math.max(1, list.length) }))
    .filter((x) => x.tag)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
}

export function categoryStats(list: Section[]) {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, n]) => ({ category: getCategory(id)!, n }))
    .filter((x) => x.category)
    .sort((a, b) => b.n - a.n);
}

export function topCompanies(list: Section[], limit = 12) {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s.company, (counts.get(s.company) ?? 0) + 1);
  return [...counts.entries()]
    .map(([slug, n]) => ({ company: getCompany(slug)!, n }))
    .filter((x) => x.company?.hasPage)
    .sort((a, b) => b.n - a.n || a.company.name.localeCompare(b.company.name))
    .slice(0, limit);
}

/** Companies sharing the most style tags and section types with the given one. */
export function similarCompanies(company: Company, limit = 6) {
  const mine = new Set([...company.topTags, ...company.categories.map((c) => `c:${c}`)]);
  return companies
    .filter((c) => c.slug !== company.slug && c.hasPage)
    .map((c) => ({ c, score: [...c.topTags, ...c.categories.map((x) => `c:${x}`)].filter((t) => mine.has(t)).length + c.count / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}

export const totals = {
  sections: sections.length,
  companies: companies.filter((c) => c.slug !== 'unknown').length,
  categories: categories.length,
  styles: pagedTags.length,
  industries: pagedIndustries.length,
  updated: sections.map((s) => s.addedAt).sort().at(-1)!,
};
