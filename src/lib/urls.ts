import { SITE } from './site';

export const categoryUrl = (id: string) => `/${id}-sections/`;
export const tagUrl = (id: string) => `/tags/${id}/`;
export const companyUrl = (slug: string) => `/companies/${slug}/`;
export const industryUrl = (id: string) => `/industries/${id}/`;
export const shotUrl = (file: string) => `/shots/${file}`;
export const absolute = (path: string) => new URL(path, SITE.url).href;
