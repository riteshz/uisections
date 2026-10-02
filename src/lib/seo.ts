import { SITE } from './site';
import type { Category, Company, Section, Tag } from './data';
import { topCompanies } from './data';

/** Search-intent names per section type (used in titles, H1s and copy). */
export const CATEGORY_SEO: Record<string, { name: string; keyword: string }> = {
  hero: { name: 'Hero Section', keyword: 'hero section' },
  feature: { name: 'Features Section', keyword: 'features section' },
  'value-proposition': { name: 'Value Proposition Section', keyword: 'value proposition section' },
  'how-it-works': { name: 'How It Works Section', keyword: 'how it works section' },
  'use-case': { name: 'Use Case Section', keyword: 'use case section' },
  testimonial: { name: 'Testimonial Section', keyword: 'testimonial section' },
  'logo-cloud': { name: 'Logo Cloud', keyword: 'logo cloud' },
  stats: { name: 'Stats Section', keyword: 'stats section' },
  integration: { name: 'Integrations Section', keyword: 'integrations section' },
  security: { name: 'Security Section', keyword: 'security section' },
  pricing: { name: 'Pricing Section', keyword: 'pricing section' },
  comparison: { name: 'Comparison Section', keyword: 'comparison section' },
  faq: { name: 'FAQ Section', keyword: 'FAQ section' },
  cta: { name: 'CTA Section', keyword: 'call to action section' },
  newsletter: { name: 'Newsletter Section', keyword: 'newsletter signup section' },
  blog: { name: 'Blog Section', keyword: 'blog and resources section' },
  team: { name: 'Team Section', keyword: 'team section' },
  careers: { name: 'Careers Section', keyword: 'careers section' },
  contact: { name: 'Contact Section', keyword: 'contact section' },
  about: { name: 'About Section', keyword: 'about and mission section' },
  footer: { name: 'Footer', keyword: 'website footer' },
  navbar: { name: 'Navbar', keyword: 'navigation bar' },
};

/** Lowercase ordinary words but keep acronyms like 3D, FAQ, CTA. */
const lower = (s: string) => s.split(' ').map((w) => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w)).join(' ');
const titleCase = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
const fit = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max - 1).replace(/[\s,;:–—-]+\S*$/, '') + '…');
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const withBrand = (title: string) => (title.length + SITE.name.length + 3 <= 65 ? `${title} · ${SITE.name}` : fit(title, 65));

export function categorySeo(c: Category, items: Section[]) {
  const seo = CATEGORY_SEO[c.id] ?? { name: c.label, keyword: c.label.toLowerCase() };
  const names = topCompanies(items, 3).map((x) => x.company.name);
  return {
    name: seo.name,
    keyword: seo.keyword,
    h1: `${seo.name} Examples`,
    title: withBrand(`${seo.name} Examples (${c.count})`),
    description: fit(
      `Browse ${c.count} real ${seo.keyword} designs from ${list(names)} and more. Filter by style — dark mode, bento, gradient — and find your next layout.`,
      160,
    ),
  };
}

export function tagSeo(t: Tag, items: Section[]) {
  const names = topCompanies(items, 3).map((x) => x.company.name);
  return {
    h1: `${titleCase(t.label)} Website Design Examples`,
    title: withBrand(`${titleCase(t.label)} Website Sections (${t.count})`),
    description: fit(
      `${t.count} website sections with a ${lower(t.label)} look — heroes, features, pricing and more from ${list(names)}. Curated real-world examples.`,
      160,
    ),
  };
}

export function companySeo(c: Company, labels: string[]) {
  return {
    h1: `${c.name} website design`,
    title: withBrand(`${c.name} Website Design — ${c.count} Sections`),
    description: fit(
      `See how ${c.name} designs its website: ${c.count} real sections including ${list(labels.slice(0, 4).map(lower))}. Part of the UI Sections library.`,
      160,
    ),
  };
}

export { fit, list, withBrand, lower, titleCase };
