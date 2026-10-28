import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { PRICE_FIELDS } from '../public/shared.js';

const ALIAS = { SERPAPI_KEY: 'SERPERAPI_KEY' };
const read = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
export const env = (k) => read(k) ?? (ALIAS[k] ? read(ALIAS[k]) : undefined);

// ---------- responses ----------
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// ---------- auth ----------
const SESSION_DAYS = 180;
function secret() {
  const pw = env('APP_PASSWORD');
  if (!pw) throw new Error('APP_PASSWORD is not set in Netlify');
  return crypto.createHash('sha256').update('pricewatch:' + pw).digest();
}
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return payload + '.' + sign(payload);
}
export function checkPassword(input) {
  const pw = env('APP_PASSWORD') || '';
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  return pw.length > 0 && crypto.timingSafeEqual(a, b);
}
export function authed(req) {
  const h = req.headers.get('authorization') || '';
  const [payload, sig] = (h.startsWith('Bearer ') ? h.slice(7) : '').split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

// ---------- storage (Netlify Blobs) ----------
const STATE_KEY = 'state';
function store() {
  if (globalThis.__PW_TEST_STORE) return globalThis.__PW_TEST_STORE;
  return getStore({ name: 'pricewatch', consistency: 'strong' });
}
export async function readState() {
  return (await store().get(STATE_KEY, { type: 'json' })) || null;
}
export async function writeState(state) {
  state.savedAt = Date.now();
  await store().setJSON(STATE_KEY, state);
  return state.savedAt;
}
export async function readJSON(key) { return (await store().get(key, { type: 'json' })) || null; }
export async function writeJSON(key, v) { await store().setJSON(key, v); }

// Merge incoming state over stored state without losing newer price checks
// (e.g. the scheduled check ran while the phone had the app open).
export function mergeState(incoming, stored) {
  if (!stored) return incoming;
  const storedItems = new Map();
  for (const l of stored.lists || []) for (const it of l.items || []) storedItems.set(it.id, it);
  for (const l of incoming.lists || []) {
    for (const it of l.items || []) {
      const s = storedItems.get(it.id);
      if (!s) continue;
      if ((s.checkedAt || 0) > (it.checkedAt || 0)) for (const f of PRICE_FIELDS) it[f] = s[f];
      if (s.alerted && (!it.alerted || (s.alerted.at || 0) > (it.alerted.at || 0))) it.alerted = s.alerted;
    }
  }
  return incoming;
}

// ---------- SerpApi ----------
const SERP = () => env('SERPAPI_BASE') || 'https://serpapi.com';
const AU = { gl: 'au', hl: 'en', google_domain: 'google.com.au', location: 'Australia' };

export class QuotaError extends Error {}

async function serp(params) {
  const key = env('SERPAPI_KEY');
  if (!key) throw new Error('SERPAPI_KEY is not set in Netlify');
  const r = await fetch(`${SERP()}/search.json?${new URLSearchParams({ ...params, api_key: key })}`);
  const j = await r.json().catch(() => ({}));
  if (j.error) {
    if (/run out|searches per month|limit|quota|upgrade/i.test(j.error) || r.status === 429) throw new QuotaError(j.error);
    throw new Error(j.error);
  }
  if (!r.ok) throw new Error('Price search failed (' + r.status + ')');
  return j;
}

export async function serpAccount() {
  const key = env('SERPAPI_KEY');
  if (!key) throw new Error('SERPAPI_KEY is not set in Netlify');
  const r = await fetch(`${SERP()}/account.json?api_key=${encodeURIComponent(key)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Account lookup failed');
  return { used: j.this_month_usage ?? null, limit: j.searches_per_month ?? null, left: j.plan_searches_left ?? j.total_searches_left ?? null };
}

const USED = /\b(refurb(ished)?|renewed|pre[- ]?owned|used|second[- ]?hand|open[- ]?box|ex[- ]?demo|ex[- ]?display|reconditioned|grade [abc]|parts only|faulty)\b/i;
export const looksUsed = (...t) => t.flat().filter(Boolean).some((x) => USED.test(String(x)));

export function similarity(a, b) {
  const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9.]+/g, ' ').split(' ').filter((w) => w.length > 1));
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit++; });
  return hit / Math.max(A.size, B.size);
}

async function serpShopping(q) {
  const j = await serp({ engine: 'google_shopping', q, ...AU });
  return (j.shopping_results || [])
    .filter((r) => r.title && r.extracted_price != null)
    .filter((r) => !looksUsed(r.title, r.snippet, r.extensions, r.second_hand_condition))
    .map((r) => ({
      title: r.title,
      price: r.extracted_price,
      source: r.source || '',
      multipleSources: !!r.multiple_sources,
      thumbnail: r.thumbnail || (r.thumbnails && r.thumbnails[0]) || '',
      token: r.immersive_product_page_token || '',
      link: r.product_link || r.link || '',
    }));
}

async function serpOffers(pageToken) {
  const j = await serp({ engine: 'google_immersive_product', page_token: pageToken, more_stores: 'true', gl: 'au', hl: 'en' });
  return ((j.product_results && j.product_results.stores) || [])
    .filter((s) => s.link && s.extracted_price != null)
    .filter((s) => !s.monthly_payment_duration && !s.down_payment)
    .filter((s) => !looksUsed(s.title, s.details_and_offers, s.tag))
    .map((s) => {
      const ship = typeof s.shipping_extracted === 'number' ? s.shipping_extracted : 0;
      const total = typeof s.extracted_total === 'number' ? s.extracted_total : s.extracted_price + ship;
      return {
        store: s.name || 'Store',
        price: s.extracted_price,
        total: Math.round(total * 100) / 100,
        shipping: s.shipping || '',
        link: s.link,
        note: (s.details_and_offers || []).slice(0, 2).join(' · '),
      };
    })
    .sort((a, b) => a.total - b.total);
}

// ---------- Serper.dev (optional backup, used when SerpApi's allowance runs out) ----------
const SERPER = () => env('SERPER_BASE') || 'https://google.serper.dev';
export const hasBackup = () => !!env('SERPER_API_KEY');

const parsePrice = (s) => {
  if (typeof s === 'number') return s;
  const m = String(s || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};

async function serperShopping(q) {
  const key = env('SERPER_API_KEY');
  if (!key) throw new QuotaError('Monthly price searches used up');
  const r = await fetch(`${SERPER()}/shopping`, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'au', hl: 'en', location: 'Australia' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Backup search failed: ' + (j.message || r.status));
  return (j.shopping || [])
    .map((r) => ({
      title: r.title || '',
      price: parsePrice(r.price),
      source: r.source || '',
      thumbnail: r.imageUrl || '',
      link: r.link || '',
      delivery: r.delivery || '',
      token: '',
      multipleSources: false,
    }))
    .filter((r) => r.title && r.price != null && r.link)
    .filter((r) => !looksUsed(r.title));
}

// ---------- public operations ----------
export async function searchProducts(q) {
  try {
    return { results: await serpShopping(q), via: 'serpapi' };
  } catch (e) {
    if (e instanceof QuotaError && hasBackup()) return { results: await serperShopping(q), via: 'backup' };
    throw e;
  }
}

// Find every new-condition offer for a saved item.
export async function checkItem(item) {
  const { token, query, title } = item;
  const done = (offers, extra = {}) => ({ offers, checkedAt: Date.now(), ...extra });
  try {
    if (token) {
      try {
        const offers = await serpOffers(token);
        if (offers.length) return done(offers, { via: 'serpapi' });
      } catch (e) { if (e instanceof QuotaError) throw e; }
    }
    const ranked = (await serpShopping(query || title))
      .map((c) => ({ c, s: similarity(title || query, c.title) }))
      .sort((a, b) => b.s - a.s);
    const match = ranked.length && ranked[0].s >= 0.5 ? ranked[0].c : null;
    if (!match) throw new Error("Couldn't find this exact product right now");
    if (match.token) {
      try {
        const offers = await serpOffers(match.token);
        if (offers.length) return done(offers, { newToken: match.token, via: 'serpapi' });
      } catch (e) { if (e instanceof QuotaError) throw e; }
    }
    return done([{ store: match.source || 'Google Shopping', price: match.price, total: match.price, shipping: '', link: match.link, note: '' }], { newToken: match.token || undefined, via: 'serpapi' });
  } catch (e) {
    if (!(e instanceof QuotaError) || !hasBackup()) throw e;
    // Backup: one search, keep listings that match this product.
    const rows = (await serperShopping(query || title))
      .map((c) => ({ c, s: similarity(title || query, c.title) }))
      .filter((x) => x.s >= 0.5)
      .map(({ c }) => ({ store: c.source || 'Store', price: c.price, total: c.price, shipping: c.delivery, link: c.link, note: '' }))
      .sort((a, b) => a.total - b.total);
    if (!rows.length) throw new Error("Couldn't find this exact product right now");
    return done(rows, { via: 'backup' });
  }
}

// ---------- ntfy (phone alerts) ----------
export async function notify(topic, { title, message, click, tags = 'chart_with_downwards_trend', priority = 'high' }) {
  if (!topic) throw new Error('No alert topic set');
  const base = env('NTFY_BASE') || 'https://ntfy.sh';
  const headers = { Title: String(title).replace(/[^\x20-\x7E]/g, '').slice(0, 200), Tags: tags, Priority: priority };
  click = click && /^https?:\/\/[\x21-\x7E]+$/.test(click) ? click : '';
  if (click) headers.Click = click;
  const r = await fetch(`${base}/${encodeURIComponent(topic)}`, { method: 'POST', headers, body: message });
  if (!r.ok) throw new Error('Alert failed (' + r.status + ')');
}
