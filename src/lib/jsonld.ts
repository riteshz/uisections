import { SITE } from './site';
import { absolute, shotUrl } from './urls';
import type { Section } from './data';

export type Crumb = { name: string; path: string };

const WEBSITE_ID = `${SITE.url}/#website`;
const ORG_ID = `${SITE.url}/#organization`;

export const websiteNode = () => ({
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: `${SITE.url}/`,
  name: SITE.name,
  description: SITE.description,
  inLanguage: 'en',
  publisher: { '@id': ORG_ID },
});

export const organizationNode = () => ({
  '@type': 'Organization',
  '@id': ORG_ID,
  name: SITE.name,
  url: `${SITE.url}/`,
  logo: { '@type': 'ImageObject', url: absolute('/logo-512.png'), width: 512, height: 512 },
  email: SITE.email,
});

export const breadcrumbNode = (crumbs: Crumb[]) => ({
  '@type': 'BreadcrumbList',
  '@id': `${absolute(crumbs.at(-1)!.path)}#breadcrumb`,
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absolute(c.path) })),
});

/** CollectionPage whose ItemList only embeds the first 24 images (no rich result needs more). */
export const collectionNode = (opts: { path: string; name: string; description: string; items: Section[]; crumbs?: boolean }) => ({
  '@type': 'CollectionPage',
  '@id': `${absolute(opts.path)}#page`,
  url: absolute(opts.path),
  name: opts.name,
  description: opts.description,
  isPartOf: { '@id': WEBSITE_ID },
  inLanguage: 'en',
  ...(opts.crumbs === false ? {} : { breadcrumb: { '@id': `${absolute(opts.path)}#breadcrumb` } }),
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: opts.items.length,
    itemListElement: opts.items.slice(0, 24).map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'ImageObject',
        contentUrl: absolute(shotUrl(s.files.lg)),
        thumbnailUrl: absolute(shotUrl(s.files['480'])),
        name: s.headline ? `${s.companyName}: ${s.headline}` : s.alt,
        description: s.alt,
        width: s.large.w,
        height: s.large.h,
        creditText: s.companyName,
      },
    })),
  },
});

export const graph = (...nodes: object[]) => ({ '@context': 'https://schema.org', '@graph': nodes });
