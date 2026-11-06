const PRODUCT_API = 'https://api.upcitemdb.com/prod/trial/lookup';
const CATALOG_HOSTS = new Set(['upcitemdb.com', 'www.upcitemdb.com']);
const RETAIL_HOSTS = new Set(['acehardware.com','www.acehardware.com','truevalue.com','www.truevalue.com','klemsonline.com']);
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
    {label: 'True Value', url: 'https://www.truevalue.com/search/?q=' + encodeURIComponent(barcode)}
  ];
}
function catalogLinks(item) {
  return (Array.isArray(item.offers) ? item.offers : []).slice(0, 60).flatMap(raw => {
    const domain = clean(raw.domain, 100).toLowerCase().replace(/^www\./, '');
    const url = safeProductURL(raw.link);
    return url && ['acehardware.com', 'truevalue.com'].includes(domain) ? [{domain, url}] : [];
  });
}
export function directRetailerURL(value) {
  const safe = safeProductURL(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (RETAIL_HOSTS.has(url.hostname)) return url.href;
  for (const key of ['url','u','destination','dest','redirect','redirect_url','redirecturl','target']) {
    const target = safeProductURL(url.searchParams.get(key));
    if (target && RETAIL_HOSTS.has(new URL(target).hostname)) return target;
  }
  return null;
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
      const number = clean(sku, 40) || parsed.pathname.match(/(?:\/departments\/.+|\/p)\/(\d{4,9})\/?$/)?.[1];
      if (number && /^[A-Za-z0-9.-]{2,40}$/.test(number)) return {merchant: 'Ace Hardware', number, url: parsed.href};
    }
    if (host === 'truevalue.com' && /^[A-Za-z0-9.-]{2,40}$/.test(clean(sku, 40))) return {merchant: 'True Value', number: clean(sku,40), url: parsed.href};
  } catch {}
  return null;
}
async function publicRetailerPage(initial, fetcher, trace = [], signal = AbortSignal.timeout(8000)) {
  let current = directRetailerURL(initial) || safeProductURL(initial);
  if (!current) return null;
  for (let redirects = 0; redirects < 5; redirects++) {
    const url = new URL(current);
    if (!RETAIL_HOSTS.has(url.hostname) && !(CATALOG_HOSTS.has(url.hostname) && url.pathname.startsWith('/norob/'))) { console.warn('Retailer redirect unsupported', url.hostname); return null; }
    const response = await fetcher(url.href, {redirect: 'manual', signal, headers: {'Accept': 'text/html', 'User-Agent': 'AceToolsProductLookup/1.0'}});
    trace.push({host: url.hostname, status: response.status, ...(retailerItemNumber(url.href) ? {retailer_url: url.href} : {})});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('Location'); if (!location) { console.warn('Retailer redirect missing location', url.hostname); return null; }
      await response.body?.cancel();
      const redirected = safeProductURL(new URL(location, current).href);
      current = directRetailerURL(redirected) || redirected; if (!current) return null;
      continue;
    }
    if (!response.ok || !RETAIL_HOSTS.has(url.hostname)) { console.warn('Retailer verification fetch failed', url.hostname, response.status); await response.body?.cancel(); return null; }
    if (!response.headers.get('Content-Type')?.includes('text/html')) { console.warn('Retailer page was not HTML', url.hostname, response.headers.get('Content-Type')); await response.body?.cancel(); return null; }
    const reader = response.body?.getReader(); if (!reader) return null;
    const decoder = new TextDecoder(); let html = '', bytes = 0;
    try { while (true) { const {done,value} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 1500000) break; html += decoder.decode(value, {stream: true}); } }
    finally { await reader.cancel(); }
    trace.push({host: url.hostname, html_bytes: bytes});
    return {url: current, html};
  }
  return null;
}
async function enrichRetailer(offer, barcode, now, fetcher, signal) {
  let page = null, product = null;
  const verification = {merchant: offer.domain, requests: []};
  const candidates = new Set();
  for (const url of [offer.url, offer.fallback_url].filter(Boolean)) {
    try {
      const candidate = await publicRetailerPage(url, fetcher, verification.requests, signal);
      if (!candidate || new URL(candidate.url).hostname.replace(/^www\./, '') !== offer.domain) continue;
      const matched = retailerProduct(candidate.html, barcode);
      if (matched) { page = candidate; product = matched; break; }
      if (offer.domain === 'acehardware.com' && new URL(candidate.url).pathname === '/search') {
        for (const match of candidate.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
          try {
            const url = new URL(match[1].replace(/&amp;/g, '&'), candidate.url);
            if (url.hostname.replace(/^www\./, '') !== 'acehardware.com' || !retailerItemNumber(url.href)) continue;
            url.search = ''; url.hash = ''; candidates.add(url.href);
            if (candidates.size === 2) break;
          } catch {}
        }
      }
    } catch (error) { verification.requests.push({error: error.name, message: clean(error.message, 120)}); console.warn('Retailer verification failed', offer.domain, error.name); }
  }
  // Extra persistence only after the existing direct and catalog attempts miss.
  // Check at most two search results concurrently, with one shared short budget.
  if (!product && candidates.size) {
    const signal = AbortSignal.timeout(2500);
    const matches = await Promise.all([...candidates].map(async url => {
      try {
        const candidate = await publicRetailerPage(url, fetcher, [], signal);
        const matched = candidate && new URL(candidate.url).hostname.replace(/^www\./, '') === offer.domain && retailerProduct(candidate.html, barcode);
        return matched ? {page: candidate, product: matched} : null;
      } catch { return null; }
    }));
    const match = matches.find(Boolean);
    if (match) { page = match.page; product = match.product; }
  }
  if (!product) {
    const identified = verification.requests.filter(request => [401,403,429,503].includes(request.status)).map(request => request.retailer_url ? retailerItemNumber(request.retailer_url) : null).find(Boolean);
    return {verification, ...(identified ? {identifier: {...identified, verified: false}} : {})};
  }
  const found = retailerItemNumber(page.url, product.sku);
  const identifier = found ? {...found, verified: true} : null;
  const model = clean(product.mpn || (typeof product.model === 'object' ? product.model.name : product.model), 100);
  return {identifier, model, title: clean(product.name, 300), verification};
}

function sourceItem(item, barcode, now) {
  return {barcode, title: clean(item.title, 300), brand: clean(item.brand, 100), model: clean(item.model, 100) || null, item_number: null, source_url: 'https://www.upcitemdb.com/upc/' + barcode, checked_at: new Date(now).toISOString(), links: productSearchLinks(barcode)};
}
export async function findProduct(barcode, fetcher = fetch, now = Date.now()) {
  let response;
  try { response = await fetcher(PRODUCT_API + '?upc=' + encodeURIComponent(barcode), {signal: AbortSignal.timeout(12000), headers: {'Accept': 'application/json'}}); }
  catch { fail('Product lookup is unavailable. Try again or search the stores below.', 503); }
  if (response.status === 429) fail('Product lookup limit reached. Try later or search the stores below.', 429);

  if (!response.ok && response.status !== 404) fail('Product lookup is unavailable. Try again or search the stores below.', 503);
  let body;
  try { body = response.status === 404 ? {items: []} : await response.json(); } catch { fail('Product lookup is unavailable. Try again.', 503); }
  const item = (Array.isArray(body.items) ? body.items : []).find(item => matchesBarcode(item, barcode) && clean(item.title));
  const result = sourceItem(item || {}, barcode, now);
  const links = catalogLinks(item || {});
  const ace = {domain: 'acehardware.com', url: 'https://www.acehardware.com/search?query=' + encodeURIComponent(barcode), fallback_url: links.find(link => link.domain === 'acehardware.com')?.url};
  const extra = await enrichRetailer(ace, barcode, now, fetcher);
  if (extra.identifier) result.item_number = extra.identifier;
  if (extra.model) result.model = extra.model;
  if (!result.title && extra.title) result.title = extra.title;
  // A public Ace dealer provides exact barcode/SKU data when Ace blocks server requests.
  // Keep dealer identifiers selectable, rather than automatically importing them.
  if (!result.item_number) {
    try {
      const dealer = await publicRetailerPage('https://klemsonline.com/p/item-' + encodeURIComponent(barcode), fetcher, [], AbortSignal.timeout(2500));
      const matched = dealer && new URL(dealer.url).hostname === 'klemsonline.com' && retailerProduct(dealer.html, barcode);
      const number = clean(matched?.sku, 40);
      if (matched && /^\d{4,9}$/.test(number)) {
        result.item_number = {merchant: 'Ace Hardware', number, url: dealer.url, verified: false, source_label: 'Ace dealer match'};
        result.title ||= clean(matched.name, 300);
        result.model ||= clean(matched.mpn, 100) || null;
      }
    } catch (error) { console.warn('Ace dealer lookup failed', error.name); }
  }
  // True Value is only needed when Ace did not supply an item number.
  const trueValue = links.find(link => link.domain === 'truevalue.com');
  if (!result.item_number && trueValue) {
    const fallback = await enrichRetailer(trueValue, barcode, now, fetcher, AbortSignal.timeout(2000));
    if (fallback.identifier) result.item_number = fallback.identifier;
    if (!result.model && fallback.model) result.model = fallback.model;
    if (!result.title && fallback.title) result.title = fallback.title;
  }
  if (!item && !result.item_number) return {barcode, found: false, links: productSearchLinks(barcode)};
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
  const cacheKey = 'items-v9:' + gtinKey(barcode);
  const cached = await env.DB.prepare('SELECT data FROM product_cache WHERE barcode = ? AND expires_at > ?').bind(cacheKey, now).first();
  if (cached) {
    const data = JSON.parse(cached.data);
    return {...data, server_time: new Date(now).toISOString()};
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = Math.floor(now / 60000);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + ':' + bucket)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  if (!await quota(env.DB, 'minute:' + digest, 10, (bucket+1)*60000)) fail('Too many lookups. Try again in a minute.', 429);
  const day = Math.floor(now / 86400000);
  if (!await quota(env.DB, 'day:' + day, 90, (day+1)*86400000)) fail('Product lookup limit reached. Try later or search the stores below.', 429);
  const result = await findProduct(barcode, fetcher, now);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO product_cache (barcode, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(barcode) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at').bind(cacheKey, JSON.stringify(result), now + 300000),
    env.DB.prepare('DELETE FROM product_cache WHERE expires_at < ?').bind(now - 86400000),
    env.DB.prepare('DELETE FROM lookup_limits WHERE expires_at < ?').bind(now)
  ]);
  return {...result, server_time: new Date(now).toISOString()};
}
