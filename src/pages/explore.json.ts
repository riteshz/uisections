// Static JSON for the Explore feed: "Show more" pages and the filter dialog load it on demand.
import type { APIRoute } from 'astro';
import { exploreData } from '../lib/explore';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(exploreData()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
