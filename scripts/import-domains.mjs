// Merges verified company websites into data/companies.json:
//  1. headline-verified hits from scripts/find-domains.mjs (data/agent-batches/domain-probe.json),
//  2. research results in data/tag-runs/domains-*.json (confidence high or medium only).
// A domain is written only if its site still answers over HTTPS (bot walls such as
// 403/429 count as alive), and only for companies without a hand-set domain. Usage: node scripts/import-domains.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { Resolver } from 'node:dns/promises';
import { DATA_DIR, readJson, writeJson } from './lib/common.mjs';

const DRY = process.argv.includes('--dry');
// Probe matches that rested on a generic headline ("Frequently asked questions"); research decides these.
const SUSPECT = new Set(['exante', 'melius', 'finsepa']);
// Research results reviewed and rejected: evidence too thin (proto.xyz matched only a generic footer).
const REJECT = new Set(['proto']);
const metaFile = path.join(DATA_DIR, 'companies.json');
const meta = readJson(metaFile, {});
const resolver = new Resolver({ timeout: 3000, tries: 2 });
const resolves = async (h) => {
  try { return (await resolver.resolve4(h)).length > 0; } catch {
    try { return (await resolver.resolve6(h)).length > 0; } catch { return false; }
  }
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
/** null when the site answers; otherwise why it doesn't (no DNS, TLS error, timeout, 404, 5xx). */
async function deadReason(host) {
  if (!(await resolves(host))) return 'no DNS';
  try {
    const res = await fetch(`https://${host}/`, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    await res.body?.cancel();
    return res.status === 404 || res.status === 410 || res.status >= 500 ? `HTTP ${res.status}` : null;
  } catch (e) {
    return String(e.cause?.code ?? e.name ?? 'fetch failed');
  }
}
const clean = (d) => String(d ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '') || null;

const found = new Map(); // slug -> { name, domain, source, evidence }
for (const r of readJson(path.join(DATA_DIR, 'agent-batches', 'domain-probe.json'), [])) {
  if (r.verified && !SUSPECT.has(r.slug)) found.set(r.slug, { name: r.name, domain: clean(r.verified), source: 'probe', evidence: r.matched.join(' | ') });
}
const runs = path.join(DATA_DIR, 'tag-runs');
const nulls = [];
for (const f of fs.readdirSync(runs).filter((f) => /^domains-D\d+\.json$/.test(f)).sort()) {
  for (const c of readJson(path.join(runs, f)).companies ?? []) {
    const domain = clean(c.domain);
    if (domain && !REJECT.has(c.slug) && (c.confidence === 'high' || c.confidence === 'medium')) found.set(c.slug, { name: null, domain, source: `${f}:${c.confidence}`, evidence: c.evidence });
    else nulls.push(c.slug);
  }
}

const added = [];
const dead = [];
const kept = [];
for (const [slug, f] of found) {
  if (meta[slug]?.domain) { kept.push(slug); continue; }
  const why = await deadReason(f.domain);
  if (why) { dead.push(`${slug} → ${f.domain} (${why})`); continue; }
  added.push({ slug, ...f });
  if (!DRY) {
    const { verified, ...rest } = meta[slug] ?? {};
    meta[slug] = { ...rest, ...(rest.name || !f.name ? {} : { name: f.name }), domain: f.domain };
  }
}
if (!DRY) writeJson(metaFile, meta);

console.log(`${DRY ? '[dry run] ' : ''}Added ${added.length} domains (${added.filter((a) => a.source === 'probe').length} from the probe, ${added.filter((a) => a.source !== 'probe').length} from research)`);
if (kept.length) console.log(`Already set by hand, left alone: ${kept.join(', ')}`);
if (dead.length) console.log(`Skipped, site not answering: ${dead.join('; ')}`);
if (nulls.length) console.log(`Not found (${nulls.length}): ${nulls.join(', ')}`);
writeJson(path.join(DATA_DIR, 'agent-batches', 'domain-import.json'), { added, dead, nulls });
