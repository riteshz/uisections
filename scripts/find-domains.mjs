// Finds and checks company websites. For each company it fetches candidate
// domains (name.com, name.ai, getname.com, …) and accepts one only when the
// live page contains a headline from our own screenshots of that company.
// Existing domains are re-checked the same way.
// Output: data/agent-batches/domain-probe.json (nothing in the site data changes).
// Usage: node scripts/find-domains.mjs [--existing]
import { Resolver } from 'node:dns/promises';
import path from 'node:path';
import { DATA_DIR, GEN_DIR, readJson, writeJson } from './lib/common.mjs';

const CHECK_EXISTING = process.argv.includes('--existing');
const companies = readJson(path.join(GEN_DIR, 'companies.json')).filter((c) => c.slug !== 'unknown');
const sections = readJson(path.join(GEN_DIR, 'sections.json'));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’‘]/g, "'").replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const headlinesOf = (slug) => [...new Set(sections.filter((s) => s.company === slug).map((s) => norm(s.headline)).filter((h) => h.length >= 12))];

function candidates(c) {
  const bases = new Set([c.slug.replace(/-/g, ''), c.slug, norm(c.name).replace(/ /g, '')].filter(Boolean));
  const out = new Set();
  for (const b of bases) {
    for (const tld of ['com', 'ai', 'io', 'so', 'co', 'app', 'dev', 'xyz', 'tech', 'net', 'org']) out.add(`${b}.${tld}`);
    for (const p of ['get', 'try', 'use', 'join']) { out.add(`${p}${b}.com`); out.add(`${p}${b}.ai`); }
    out.add(`${b}hq.com`);
    out.add(`${b}app.com`);
    if (!b.endsWith('ai')) out.add(`${b}ai.com`);
  }
  return [...out];
}

// c-ares resolver (not the 4-thread getaddrinfo pool), with a short timeout.
const resolver = new Resolver({ timeout: 2500, tries: 2 });
async function resolves(host) {
  try { return (await resolver.resolve4(host)).length > 0; } catch {
    try { return (await resolver.resolve6(host)).length > 0; } catch { return false; }
  }
}

async function fetchPage(host) {
  try {
    const res = await fetch(`https://${host}/`, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const html = (await res.text()).slice(0, 3_000_000);
    const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '';
    const text = norm(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
    // Some sites (Framer, Next) also carry copy inside JSON in scripts; keep a raw fallback.
    const raw = norm(html);
    return { ok: res.ok, status: res.status, finalHost: new URL(res.url).hostname.replace(/^www\./, ''), title, text, raw };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.cause?.code ?? e.name ?? e) };
  }
}

function score(page, c, headlines) {
  if (!page?.text) return { matches: [], nameInTitle: false };
  const matches = headlines.filter((h) => page.text.includes(h) || page.raw.includes(h));
  const nameInTitle = norm(page.title).includes(norm(c.name));
  return { matches, nameInTitle };
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const targets = companies.filter((c) => (CHECK_EXISTING ? c.domain : !c.domain));
let done = 0;
const results = await pool(targets, 10, async (c) => {
  const headlines = headlinesOf(c.slug);
  const hosts = CHECK_EXISTING ? [c.domain] : candidates(c);
  const live = (await pool(hosts, 12, async (h) => ((await resolves(h)) ? h : null))).filter(Boolean);
  const tried = await pool(live, 8, async (host) => {
    const page = await fetchPage(host);
    const s = score(page, c, headlines);
    return { host, finalHost: page.finalHost ?? null, status: page.status, error: page.error, title: page.title?.slice(0, 120), matches: s.matches.length, matched: s.matches.slice(0, 3), nameInTitle: s.nameInTitle };
  });
  const best = tried.filter((t) => t.matches > 0).sort((a, b) => b.matches - a.matches)[0] ?? null;
  done++;
  if (done % 5 === 0) console.log(`  ${done}/${targets.length}`);
  return {
    slug: c.slug, name: c.name, current: c.domain ?? null, headlines: headlines.length,
    verified: best ? (best.finalHost || best.host) : null,
    via: best?.host ?? null, matched: best?.matched ?? [],
    titleOnly: tried.filter((t) => !t.matches && t.nameInTitle && t.status && t.status < 400).map((t) => t.finalHost || t.host),
    tried,
  };
});

const file = path.join(DATA_DIR, 'agent-batches', CHECK_EXISTING ? 'domain-check-existing.json' : 'domain-probe.json');
writeJson(file, results);
const verified = results.filter((r) => r.verified);
console.log(`${CHECK_EXISTING ? 'Existing domains re-checked' : 'Missing domains probed'}: ${results.length} | headline-verified: ${verified.length} | name-in-title only: ${results.filter((r) => !r.verified && r.titleOnly.length).length} | nothing: ${results.filter((r) => !r.verified && !r.titleOnly.length).length}`);
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
