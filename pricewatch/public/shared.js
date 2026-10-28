// Logic shared by the app (browser) and the server (price checks + alerts).

// Well-known Australian retailers and brand stores, used by "Major retailers only".
export const MAJOR_STORES = [
  'jb hi-fi', 'jb hifi', 'harvey norman', 'the good guys', 'officeworks', 'bing lee', 'appliances online',
  'winning appliances', 'e&s', 'amazon', 'big w', 'kmart', 'target', 'myer', 'david jones', 'bunnings',
  'mitre 10', 'total tools', 'sydney tools', 'kogan', 'apple', 'samsung', 'sony', 'dyson', 'bose', 'lenovo',
  'dell', 'hp', 'microsoft', 'google store', 'garmin', 'logitech', 'jbl', 'sonos', 'nintendo',
  'mwave', 'scorptec', 'pc case gear', 'pccasegear', 'umart', 'centre com', 'msy', 'ple computers', 'jw computers',
  'rebel', 'rebel sport', 'anaconda', 'bcf', 'kathmandu', 'macpac', 'supercheap auto', 'repco', 'autobarn',
  'chemist warehouse', 'priceline', 'adore beauty', 'sephora', 'mecca', 'the iconic', 'nike', 'adidas',
  'jd sports', 'platypus', 'foot locker', 'culture kings', 'ikea', 'temple & webster', 'freedom', 'amart',
  'fantastic furniture', 'koala', 'spotlight', 'lego', 'toymate', 'ebgames', 'eb games', 'jb hi-fi business',
  'godfreys', 'petbarn', 'petstock', 'catch',
];

export function normStore(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\.com(\.au)?|\.au\b/g, ' ')
    .replace(/\b(australia|au|online|store|official|shop)\b/g, ' ')
    .replace(/[^a-z0-9&+ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMajor(name) {
  const n = normStore(name);
  return MAJOR_STORES.some((m) => n === m || n.startsWith(m + ' ') || n.replace(/[- ]/g, '') === m.replace(/[- ]/g, ''));
}

export function isBlocked(name, settings) {
  const n = normStore(name);
  return (settings?.blocked || []).some((b) => normStore(b) === n);
}

// Offers from allowed stores, cheapest (incl. delivery) first.
export function allowedOffers(offers, settings) {
  return (offers || [])
    .filter((o) => !isBlocked(o.store, settings))
    .filter((o) => !settings?.majorOnly || isMajor(o.store))
    .slice()
    .sort((a, b) => a.total - b.total);
}

export const round2 = (n) => Math.round(n * 100) / 100;

const allowed = (store, settings) => !isBlocked(store, settings) && (!settings?.majorOnly || isMajor(store));

// Price history as seen through the current store settings. Each check keeps
// the cheapest few stores, so blocking a store or switching to major retailers
// also corrects past prices, the lowest price and the change arrows.
export function priceHistory(item, settings) {
  return (item.history || []).map((h) => {
    if (!h.s) return { t: h.t, p: h.p };
    const ok = h.s.filter(([store]) => allowed(store, settings)).map(([, total]) => total);
    return { t: h.t, p: ok.length ? Math.min(...ok) : null };
  }).filter((h) => h.p != null);
}

// Recompute best offer + derived figures from saved data (no search needed).
export function recomputeBest(item, settings) {
  const ok = allowedOffers(item.offers, settings);
  const b = ok[0];
  item.best = b ? { store: b.store, price: b.total, itemPrice: b.price, shipping: b.shipping, link: b.link, note: b.note || '' } : null;
  item.hidden = (item.offers || []).length - ok.length;
  const h = priceHistory(item, settings);
  item.firstPrice = h.length ? h[0].p : null;
  item.lowest = h.length ? Math.min(...h.map((x) => x.p)) : null;
  item.prevPrice = h.length > 1 ? h[h.length - 2].p : null;
  return item.best;
}

// Apply a fresh price check result to an item.
export function applyCheck(item, result, settings) {
  item.offers = result.offers || [];
  item.checkedAt = result.checkedAt || Date.now();
  item.via = result.via || 'serpapi';
  if (result.newToken) item.token = result.newToken;
  item.error = '';
  const cheapest = item.offers.slice().sort((a, b) => a.total - b.total);
  const top = [];
  for (const o of cheapest) { if (!top.some(([s]) => s === o.store)) top.push([o.store, o.total]); if (top.length >= 8) break; }
  if (top.length) item.history = [...(item.history || []), { t: item.checkedAt, p: top[0][1], s: top }].slice(-60);
  recomputeBest(item, settings);
  if (!item.best) item.error = item.offers.length ? 'Every store found is filtered out by your store settings' : 'No new-condition offers found';
  return item;
}

// Fields written by price checks. When two devices / the scheduled check
// save at once, the copy with the newer checkedAt wins for these fields.
export const PRICE_FIELDS = ['offers', 'best', 'hidden', 'checkedAt', 'prevPrice', 'firstPrice', 'lowest', 'history', 'token', 'error', 'via'];

// Should the scheduled check send a phone alert for this item?
export function alertReason(item) {
  if (!item.alerts || !item.best) return null;
  const p = item.best.price;
  const sent = item.alerted || null; // { price, target }
  if (item.target != null && item.target !== '') {
    const t = Number(item.target);
    if (p > t) return null;
    if (sent && sent.target === t && p >= sent.price - 0.5) return null;
    return 'target';
  }
  if (item.prevPrice != null && p < item.prevPrice - 0.5) {
    if (sent && sent.target == null && p >= sent.price - 0.5) return null;
    return 'drop';
  }
  return null;
}
