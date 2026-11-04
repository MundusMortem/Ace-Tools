export function verifiedListings(offers, now = Date.now()) {
  const merchants = new Map();
  for (const offer of Array.isArray(offers) ? offers : []) {
    const age = now - Date.parse(offer?.updated_at);
    if (offer?.verified !== true || !offer.available || offer.currency !== 'USD' || !/^new$/i.test(offer.condition || '') || typeof offer.price !== 'number' || !Number.isFinite(offer.price) || offer.price <= 0 || !Number.isFinite(age) || age < 0 || age > 300000) continue;
    let domain;
    try {
      const url = new URL(offer.url);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) continue;
      domain = url.hostname.replace(/^www\./, '');
      if (offer.domain && offer.domain.toLowerCase().replace(/^www\./, '') !== domain) continue;
    } catch { continue; }
    if (!merchants.has(domain) || merchants.get(domain).price > offer.price) merchants.set(domain, offer);
  }
  return [...merchants.values()].toSorted((a,b) => a.price - b.price || a.merchant.localeCompare(b.merchant)).slice(0,3);
}
