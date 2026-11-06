import {verifiedListings} from './listings.mjs';
import {CameraScanner, scanImage} from './camera.mjs';
const API = 'https://ace-tools.bonnylight3.chatgpt.site';
const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4M7 7v10m3-10v10m4-10v10m3-10v10"/></svg>';
const trigger = document.createElement('button');
trigger.type = 'button'; trigger.className = 'site-scanner-button'; trigger.setAttribute('aria-label', 'Scan barcode'); trigger.title = 'Scan barcode'; trigger.innerHTML = icon;
document.querySelector('header').append(trigger);
const dialog = document.createElement('dialog'); dialog.className = 'scan-dialog'; dialog.setAttribute('aria-labelledby', 'scanner-title');
dialog.innerHTML = `<div class="scan-heading"><div class="scan-title-icon">${icon}</div><h2 id="scanner-title">Barcode scanner</h2><button class="scan-icon-button scan-close" type="button" aria-label="Close scanner">×</button></div>
<div class="scan-camera" hidden><video autoplay muted playsinline aria-label="Barcode camera preview"></video><div class="scan-reticle" aria-hidden="true"></div></div>
<p class="scan-status" role="status" aria-live="polite"></p>
<div class="scan-controls"><button class="scan-control scan-start" type="button">Use camera</button><label class="scan-control scan-photo">Barcode photo<input type="file" accept="image/*" capture="environment" aria-label="Upload barcode photo"></label></div>
<form class="scan-form"><label for="scanner-code">Barcode</label><div class="scan-input-row"><input id="scanner-code" name="barcode" type="text" inputmode="numeric" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Barcode digits" maxlength="40" required><button class="scan-control scan-primary" type="submit">Look up</button></div></form>
<div class="scan-results" aria-live="polite"></div><nav class="scan-searches" aria-label="Search stores" hidden></nav>`;
document.body.append(dialog);
const find = selector => dialog.querySelector(selector);
const video = find('video'), camera = find('.scan-camera'), status = find('.scan-status'), results = find('.scan-results'), searches = find('.scan-searches'), form = find('form'), input = find('#scanner-code');
let operation = 0, controller = null, priceExpiry = null, selectAceSku = null;
const scanner = new CameraScanner(video, code => lookup(code));
function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
function link(label, url, className = '') {
  const n = node('a', className, label);
  try { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password) return node('span', className, label); n.href = u.href; }
  catch { return node('span', className, label); }
  n.target = '_blank'; n.rel = 'noopener noreferrer'; return n;
}
function setStatus(text = '', error = false) { status.textContent = text; status.classList.toggle('scan-error', error); }
function stopCamera() { scanner.stop(); camera.hidden = true; }
function storeLinks(code, links) {
  const items = links || [{label: 'Ace Hardware', url: 'https://www.acehardware.com/search?query=' + encodeURIComponent(code)}, {label: 'True Value', url: 'https://www.truevalue.com/search/?q=' + encodeURIComponent(code)}, {label: 'Compare prices', url: 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(code)}];
  searches.replaceChildren(...items.map(item => link(item.label + ' ↗', item.url, 'scan-search-link'))); searches.hidden = false;
}
function price(offer) { try { return new Intl.NumberFormat('en-US', {style: 'currency', currency: offer.currency}).format(offer.price); } catch { return offer.price + ' ' + offer.currency; } }
function date(value) { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : 'Date unknown'; }
function resultView(data, now = Date.parse(data.server_time) || Date.now()) {
  clearTimeout(priceExpiry);
  results.replaceChildren();
  storeLinks(data.barcode, data.links);
  if (!data.found) { results.append(node('p', 'scan-unavailable', 'Item not found.')); return; }
  const product = node('section', 'scan-product');
  product.append(node('h3', '', data.title));
  const details = node('dl', 'scan-details');
  const values = [['Barcode', data.barcode], ...(data.brand ? [['Brand', data.brand]] : []), ['Model', data.model || 'Not available']];
  for (const [label, value] of values) { const block = node('div'); block.append(node('dt', '', label), node('dd', '', value)); details.append(block); }
  const identifier = node('div');
  identifier.append(node('dt', '', data.item_number ? data.item_number.merchant + ' item' : 'Ace / True Value item'));
  const value = node('dd'); value.append(data.item_number ? link(data.item_number.number + ' ↗', data.item_number.url) : document.createTextNode('Not verified')); identifier.append(value);
  if (data.item_number?.verified === false) identifier.append(node('span', 'scan-offer-meta', 'Catalog match'));
  details.append(identifier);
  product.append(details);
  if (selectAceSku && data.item_number?.merchant === 'Ace Hardware') {
    const use = node('button', 'scan-control scan-primary', 'Use Ace SKU ' + data.item_number.number);
    use.type = 'button';
    use.addEventListener('click', () => useAceSku(data.item_number));
    product.append(use);
  }
  results.append(product);
  const listings = verifiedListings(data.offers, now);
  if (listings.length) {
    results.append(node('h4', 'scan-offers-heading', 'Verified current prices'));
    const offers = node('ol', 'scan-offers');
    for (const [index, offer] of listings.entries()) {
      const li = node('li', 'scan-offer' + (index === 0 ? ' scan-lowest' : ''));
      const info = node('div', 'scan-offer-info');
      if (index === 0) info.append(node('span', 'scan-best-label', 'Lowest verified item price'));
      info.append(link(offer.merchant + ' ↗', offer.url, 'scan-merchant'));
      info.append(node('span', 'scan-offer-meta', 'Checked ' + date(offer.updated_at)));
      info.append(node('span', 'scan-offer-meta', offer.shipping));
      li.append(info, link(price(offer), offer.url, 'scan-offer-price')); offers.append(li);
    }
    results.append(offers, node('p', 'scan-price-note', 'Before tax and shipping. Confirm at checkout.'));
    const remaining = Math.min(...listings.map(offer => Date.parse(offer.updated_at) + 300001 - now));
    priceExpiry = setTimeout(() => { if (dialog.open) resultView(data, now + remaining); }, remaining);
  } else results.append(node('p', 'scan-unavailable', 'No current prices verified.'));
  results.append(link('Product source ↗', data.source_url, 'scan-source'));
}
async function lookup(value) {
  const code = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) { setStatus('Enter an 8, 12, 13 or 14 digit barcode.', true); return; }
  const current = ++operation;
  clearTimeout(priceExpiry);
  controller?.abort(); controller = new AbortController();
  stopCamera(); input.value = code; results.replaceChildren(); storeLinks(code); setStatus('Looking up…');
  const submit = form.querySelector('button'); submit.disabled = true;
  try {
    const response = await fetch(API + '/api/products/lookup?barcode=' + encodeURIComponent(code), {signal: controller.signal, cache: 'no-store'});
    if (current !== operation) return;
    let data;
    try { data = await response.json(); } catch { throw Error('Product lookup is unavailable. Try again.'); }
    if (!response.ok) throw Error(data.error || 'Product lookup is unavailable. Try again.');
    if (current !== operation) return;
    const item = data.item_number;
    if (selectAceSku && item?.merchant === 'Ace Hardware' && item.verified !== false) {
      useAceSku(item);
      return;
    }
    setStatus(selectAceSku && item?.merchant !== 'Ace Hardware' ? 'No Ace SKU found. Enter the Ace SKU manually.' : '');
    resultView(data);
  } catch (error) {
    if (current === operation && error.name !== 'AbortError') setStatus(error.message === 'Failed to fetch' ? 'Cannot connect. Try again or search the stores below.' : error.message, true);
  } finally { if (current === operation) submit.disabled = false; }
}
async function startCamera() {
  const current = ++operation; controller?.abort(); stopCamera();
  clearTimeout(priceExpiry); results.replaceChildren(); searches.hidden = true;
  form.querySelector('button').disabled = false;
  camera.hidden = false; setStatus('Starting camera…');
  try { await scanner.start(); if (current === operation && dialog.open && scanner.stream) setStatus('Point the camera at a barcode.'); }
  catch (error) { if (current === operation) { stopCamera(); setStatus(error.message, true); } }
}
function useAceSku(item) {
  const select = selectAceSku;
  dialog.close();
  select(item.number);
}
export function openScanner(onAceSku = null) {
  if (dialog.open) return;
  selectAceSku = onAceSku;
  dialog.showModal();
  startCamera();
}
trigger.addEventListener('click', () => openScanner());
find('.scan-close').addEventListener('click', () => dialog.close());
find('.scan-start').addEventListener('click', startCamera);
form.addEventListener('submit', event => { event.preventDefault(); lookup(input.value); });
find('input[type=file]').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const current = ++operation; controller?.abort(); stopCamera(); form.querySelector('button').disabled = false; setStatus('Reading photo…');
  try { const code = await scanImage(file); if (current === operation && dialog.open) await lookup(code); }
  catch (error) { if (current === operation) setStatus(error.message, true); }
  finally { event.target.value = ''; }
});
dialog.addEventListener('close', () => { clearTimeout(priceExpiry); ++operation; controller?.abort(); stopCamera(); form.querySelector('button').disabled = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && !camera.hidden) { stopCamera(); setStatus('Camera paused.'); } });
window.addEventListener('pagehide', () => { clearTimeout(priceExpiry); ++operation; controller?.abort(); scanner.stop(); });
