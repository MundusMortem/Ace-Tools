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
let operation = 0, controller = null, selectAceSku = null, defaultAceSku = null;
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
  const items = links || [{label: 'Ace Hardware', url: 'https://www.acehardware.com/search?query=' + encodeURIComponent(code)}, {label: 'True Value', url: 'https://www.truevalue.com/search/?q=' + encodeURIComponent(code)}];
  searches.replaceChildren(...items.map(item => link(item.label + ' ↗', item.url, 'scan-search-link'))); searches.hidden = false;
}
function resultView(data) {
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
  if (data.item_number?.verified === false) identifier.append(node('span', 'scan-match-note', 'Catalog match'));
  details.append(identifier);
  product.append(details);
  if (selectAceSku && data.item_number?.merchant === 'Ace Hardware') {
    const use = node('button', 'scan-control scan-primary', 'Use Ace SKU ' + data.item_number.number);
    use.type = 'button';
    use.addEventListener('click', () => useAceSku(data.item_number, data.title));
    product.append(use);
  }
  results.append(product);
  results.append(link('Product source ↗', data.source_url, 'scan-source'));
}
async function lookup(value) {
  const code = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) { setStatus('Enter an 8, 12, 13 or 14 digit barcode.', true); return; }
  const current = ++operation;
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
      useAceSku(item, data.title);
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
  results.replaceChildren(); searches.hidden = true;
  form.querySelector('button').disabled = false;
  camera.hidden = false; setStatus('Starting camera…');
  try { await scanner.start(); if (current === operation && dialog.open && scanner.stream) setStatus('Point the camera at a barcode.'); }
  catch (error) { if (current === operation) { stopCamera(); setStatus(error.message, true); } }
}
function useAceSku(item, title) {
  const select = selectAceSku;
  dialog.close();
  select(item.number, title);
}
export function setAceSkuHandler(handler) { defaultAceSku = handler; }
export function openScanner(onAceSku = defaultAceSku) {
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
dialog.addEventListener('close', () => { ++operation; controller?.abort(); stopCamera(); form.querySelector('button').disabled = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && !camera.hidden) { stopCamera(); setStatus('Camera paused.'); } });
window.addEventListener('pagehide', () => { ++operation; controller?.abort(); scanner.stop(); });
