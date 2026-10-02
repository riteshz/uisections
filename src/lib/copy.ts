// AI-drafted, human-editable page copy (data/copy/*.json). Pages fall back to
// data-driven text when a key is missing.
const files = import.meta.glob<{ default: Record<string, PageCopy> }>('../../data/copy/*.json', { eager: true });

export interface PageCopy {
  intro: string;
  tipsTitle?: string;
  tips?: { title: string; body: string }[];
}

const pick = (name: string) => Object.entries(files).find(([p]) => p.endsWith(`/${name}.json`))?.[1].default ?? {};
const categoryCopy = pick('categories');
const tagCopy = pick('tags');
const industryCopy = pick('industries');

export const getCategoryCopy = (id: string): PageCopy | undefined => categoryCopy[id];
export const getTagCopy = (id: string): PageCopy | undefined => tagCopy[id];
export const getIndustryCopy = (id: string): PageCopy | undefined => industryCopy[id];
