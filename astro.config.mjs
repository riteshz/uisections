// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import meta from './src/data/sitemap-meta.json' with { type: 'json' };

/** @type {Record<string, { lastmod: string; images: string[]; indexable: boolean }>} */
const sitemapMeta = meta;

export default defineConfig({
  site: 'https://uisections.com',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'always' },
  // Astro 7 defaults to 'jsx' whitespace handling, which glues "236" + "sections".
  compressHTML: true,
  prerenderConflictBehavior: 'error',
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Inter',
      cssVariable: '--font-inter',
      weights: ['400 700'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
  ],
  integrations: [
    sitemap({
      filter: (url) => sitemapMeta[url]?.indexable !== false,
      serialize: (item) => {
        const m = sitemapMeta[item.url];
        if (!m) return item;
        return { ...item, lastmod: m.lastmod, img: m.images.map((url) => ({ url })) };
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
