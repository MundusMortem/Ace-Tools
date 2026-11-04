const PRODUCT_API = 'https://api.upcitemdb.com/prod/trial/lookup';
const CATALOG_HOSTS = new Set(['upcitemdb.com', 'www.upcitemdb.com']);
const RETAIL_HOSTS = new Set(['acehardware.com','www.acehardware.com','truevalue.com','www.truevalue.com','lowes.com','www.lowes.com','homedepot.com','www.homedepot.com','bestbuy.com','www.bestbuy.com','walmart.com','www.walmart.com','target.com','www.target.com','tractorsupply.com','www.tractorsupply.com']);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const clean = (value, limit = 200) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export function safeProductURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') ? url.href : null; } catch { return null; }
}
function validCheckDigit(code) {
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(code[i]) * weight;
  return (10 - sum % 10) % 10 === Number(code.at(-1));
}
export function expandUPCE(code) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, a,b,c,d,e,f,check] = code;
  let body;
  if ('012'.includes(f)) body = ns+a+b+f+'0000'+c+d+e;
  else if (f === '3') body = ns+a+b+c+'00000'+d+e;
  else if (f === '4') body = ns+a+b+c+d+'00000'+e;
  else body = ns+a+b+c+d+e+'0000'+f;
  const expanded = body + check;
  return validCheckDigit(expanded) ? expanded : null;
}
export function productBarcode(value) {
  const code = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) fail('Enter an 8, 12, 13 or 14 digit barcode.');
  if (code.length === 8 && !validCheckDigit(code)) { const expanded = expandUPCE(code); if (expanded) return expanded; }
  if (!validCheckDigit(code)) fail('Check the barcode digits.');
  return code;
}
const gtinKey = value => /^\d{8,14}$/.test(String(value)) ? String(value).padStart(14, '0') : '';
function matchesBarcode(item, barcode) { return ['gtin','gtin8','gtin12','gtin13','gtin14','ean','upc'].some(key => gtinKey(item?.[key]) === gtinKey(barcode)); }
export function productSearchLinks(barcode) {
  return [
    {label: 'Ace Hardware', url: 'https://www.acehardware.com/search?query=' + encodeURIComponent(barcode)},
    {label: 'True Value', url: 'https://www.truevalue.com/search/?q=' + encodeURIComponent(barcode)},
    {label: 'Compare prices', url: 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(barcode)}
  ];
}
function amount(value) { if (value === '' || value == null || typeof value === 'boolean') return null; const n = Number(value); return Number.isFinite(n) && n > 0 && n <= 1e8 ? n : null; }
export function catalogOffers(item, now = Date.now()) {
  return (Array.isArray(item.offers) ? item.offers : []).slice(0, 60).flatMap(raw => {
    const price = amount(raw.price), url = safeProductURL(raw.link), currency = clean(raw.currency || 'USD', 3).toUpperCase();
    if (!price || !url || !/^[A-Z]{3}$/.test(currency)) return [];
    const timestamp = Number(raw.updated_t) * 1000;
    const updatedAt = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 60000 ? new Date(timestamp).toISOString() : null;
    return [{merchant: clean(raw.merchant, 100) || clean(raw.domain, 100), domain: clean(raw.domain, 100).toLowerCase().replace(/^www\./, ''), url, price, currency, shipping: clean(raw.shipping, 80) || 'Shipping unknown', condition: clean(raw.condition, 40) || 'Condition unknown', available: !/out\s*of\s*stock|unavailable|discontinued/i.test(raw.availability || ''), updated_at: updatedAt, verified: false}];
  }).filter(offer => offer.merchant);
}
export function selectBestOffer(offers, now = Date.now()) {
  const available = offers.filter(o => o.available && o.currency === 'USD' && /^new$/i.test(o.condition));
  const verified = available.filter(o => o.verified && o.updated_at && now - Date.parse(o.updated_at) <= 1800000);
  const recent = available.filter(o => o.updated_at && now - Date.parse(o.updated_at) <= 86400000);
  const choices = verified.length ? verified : recent;
  return choices.length ? {kind: verified.length ? 'verified' : 'listed', offer: choices.toSorted((a,b) => a.price - b.price)[0]} : null;
}
function jsonObjects(value, into = []) {
  if (Array.isArray(value)) for (const item of value) jsonObjects(item, into);
  else if (value && typeof value === 'object') {
    if ([value['@type']].flat().some(t => t === 'Product' || t === 'ProductGroup')) into.push(value);
    for (const key of ['@graph','mainEntity','hasVariant','itemListElement','item']) if (value[key]) jsonObjects(value[key], into);
  }
  return into;
}
export function retailerProduct(html, barcode) {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      const products = jsonObjects(JSON.parse(match[1]));
      const product = products.find(p => matchesBarcode(p, barcode));
      if (product) return product;
    } catch {}
  }
  return null;
}
export function retailerItemNumber(url, sku) {
  try {
    const parsed = new URL(url), host = parsed.hostname.replace(/^www\./, '');
    if (host === 'acehardware.com') {
      const number = clean(sku, 40) || parsed.pathname.match(/\/departments\/.+\/(\d{4,9})\/?$/)?.[1];
      if (number && /^[A-Za-z0-9.-]{2,40}$/.test(number)) return {merchant: 'Ace Hardware', number, url: parsed.href};
    }
    if (host === 'truevalue.com' && /^[A-Za-z0-9.-]{2,40}$/.test(clean(sku, 40))) return {merchant: 'True Value', number: clean(sku,40), url: parsed.href};
  } catch {}
  return null;
}
async function publicRetailerPage(initial, fetcher) {
  const signal = AbortSignal.timeout(8000);
  let current = safeProductURL(initial);
  if (!current) return null;
  for (let redirects = 0; redirects < 5; redirects++) {
    const url = new URL(current);
    if (!RETAIL_HOSTS.has(url.hostname) && !(CATALOG_HOSTS.has(url.hostname) && url.pathname.startsWith('/norob/'))) return null;
    const response = await fetcher(url.href, {redirect: 'manual', signal, headers: {'Accept': 'text/html', 'User-Agent': 'AceToolsProductLookup/1.0'}});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('Location'); if (!location) return null;
      await response.body?.cancel();
      current = safeProductURL(new URL(location, current).href); if (!current) return null;
      continue;
    }
    if (!response.ok || !RETAIL_HOSTS.has(url.hostname)) { await response.body?.cancel(); return null; }
    if (!response.headers.get('Content-Type')?.includes('text/html')) { await response.body?.cancel(); return null; }
    const reader = response.body?.getReader(); if (!reader) return null;
    const decoder = new TextDecoder(); let html = '', bytes = 0;
    try { while (true) { const {done,value} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 1500000) break; html += decoder.decode(value, {stream: true}); } }
    finally { await reader.cancel(); }
    return {url: current, html};
  }
  return null;
}
async function enrichRetailer(offer, barcode, now, fetcher) {
  try {
    const page = await publicRetailerPage(offer.url, fetcher); if (!page) return null;
    const product = retailerProduct(page.html, barcode);
    if (!product) return null;
    const identifier = retailerItemNumber(page.url, product.sku);
    const model = clean(product.mpn || (typeof product.model === 'object' ? product.model.name : product.model), 100);
    const rawOffers = [product.offers || []].flat();
    const prices = rawOffers.filter(o => amount(o.price) && /^[A-Z]{3}$/.test(o.priceCurrency || '') && (!o.priceValidUntil || Date.parse(o.priceValidUntil + (o.priceValidUntil.length === 10 ? 'T23:59:59Z' : '')) >= now));
    const raw = prices.toSorted((a,b) => Number(a.price) - Number(b.price))[0];
    const current = raw ? {...offer, url: page.url, price: Number(raw.price), currency: raw.priceCurrency, available: /(?:\/|^)(InStock|LimitedAvailability|PreOrder|PreSale)$/i.test(raw.availability || ''), condition: /Used|Refurbished/i.test(raw.itemCondition || '') ? 'Used' : offer.condition, shipping: 'Shipping unknown', updated_at: new Date(now).toISOString(), verified: true} : null;
    return {identifier, model, offer: current};
  } catch { return null; }
}
function sourceItem(item, barcode, now) {
  return {barcode, title: clean(item.title, 300), brand: clean(item.brand, 100), model: clean(item.model, 100) || null, item_number: null, offers: catalogOffers(item, now), best: null, source_url: 'https://www.upcitemdb.com/upc/' + barcode, checked_at: new Date(now).toISOString(), links: productSearchLinks(barcode)};
}
export async function findProduct(barcode, fetcher = fetch, now = Date.now()) {
  let response;
  try { response = await fetcher(PRODUCT_API + '?upc=' + encodeURIComponent(barcode), {signal: AbortSignal.timeout(12000), headers: {'Accept': 'application/json'}}); }
  catch { fail('Product lookup is unavailable. Try again or search the stores below.', 503); }
  if (response.status === 429) fail('Product lookup limit reached. Try later or search the stores below.', 429);
  if (response.status === 404) return {barcode, found: false, links: productSearchLinks(barcode)};
  if (!response.ok) fail('Product lookup is unavailable. Try again or search the stores below.', 503);
  let body;
  try { body = await response.json(); } catch { fail('Product lookup is unavailable. Try again.', 503); }
  const item = (Array.isArray(body.items) ? body.items : []).find(item => matchesBarcode(item, barcode) && clean(item.title));
  if (!item) return {barcode, found: false, links: productSearchLinks(barcode)};
  const result = sourceItem(item, barcode, now);
  // Reserve verification slots for Ace/True Value, then compare the lowest returned USD offers.
  const priorities = [...result.offers].sort((a,b) => Number(!['acehardware.com','truevalue.com'].includes(a.domain)) - Number(!['acehardware.com','truevalue.com'].includes(b.domain)) || a.price-b.price).filter(o => o.currency === 'USD');
  const seen = new Set(), selected = priorities.filter(o => {if (seen.has(o.domain)) return false; seen.add(o.domain); return true;}).slice(0,4);
  const enrichments = await Promise.all(selected.map(offer => enrichRetailer(offer, barcode, now, fetcher)));
  for (let i = 0; i < selected.length; i++) {
    const extra = enrichments[i]; if (!extra) continue;
    if (extra.offer) result.offers[result.offers.indexOf(selected[i])] = extra.offer;
    if (extra.model && !result.model) result.model = extra.model;
    if (extra.identifier && (!result.item_number || extra.identifier.merchant === 'Ace Hardware')) result.item_number = extra.identifier;
  }
  result.best = selectBestOffer(result.offers, now);
  result.offers.sort((a,b) => Number(b.verified) - Number(a.verified) || a.currency.localeCompare(b.currency) || Number(b.available) - Number(a.available) || a.price-b.price);
  return {found: true, ...result};
}
async function quota(db, key, limit, expiresAt) {
  const result = await db.prepare('INSERT INTO lookup_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(key, expiresAt, limit).first();
  return !!result;
}
export async function productLookup(request, env, fetcher = fetch) {
  const barcode = productBarcode(new URL(request.url).searchParams.get('barcode'));
  if (!env.DB) fail('Product lookup is unavailable.', 503);
  const now = Date.now();
  const cached = await env.DB.prepare('SELECT data FROM product_cache WHERE barcode = ? AND expires_at > ?').bind(gtinKey(barcode), now).first();
  if (cached) return JSON.parse(cached.data);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = Math.floor(now / 60000);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + ':' + bucket)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  if (!await quota(env.DB, 'minute:' + digest, 10, (bucket+1)*60000)) fail('Too many lookups. Try again in a minute.', 429);
  const day = Math.floor(now / 86400000);
  if (!await quota(env.DB, 'day:' + day, 90, (day+1)*86400000)) fail('Product lookup limit reached. Try later or search the stores below.', 429);
  const result = await findProduct(barcode, fetcher, now);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO product_cache (barcode, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(barcode) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at').bind(gtinKey(barcode), JSON.stringify(result), now + (result.found ? 1200000 : 300000)),
    env.DB.prepare('DELETE FROM product_cache WHERE expires_at < ?').bind(now - 86400000),
    env.DB.prepare('DELETE FROM lookup_limits WHERE expires_at < ?').bind(now)
  ]);
  return result;
}
