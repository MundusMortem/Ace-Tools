import {addOns, rateGroups, defaultSettings, estimate} from './quote.mjs?v=3';

const endpoint = 'https://script.google.com/macros/s/AKfycbxAYm8bwE5nCOcJ0HPTexh5twHfs3geMOBqyRwRCSvdoPvlpkwyyXv63EQoVQ4XRzJI/exec';
const protocol = 'ace-special-orders-v1';
const byId = id => document.getElementById(id);
const form = byId('estimate');
const item = byId('item-type');
const width = byId('width');
const length = byId('length');
const bulkPricing = byId('bulk-pricing');
const quote = byId('quote');
const retry = byId('retry-prices');
const openAdmin = byId('open-admin');
const admin = byId('pricing-admin');
const settingsForm = byId('pricing-settings');
const login = byId('pricing-login');
const edit = byId('pricing-edit');
const fields = byId('settings-fields');
const adjustment = byId('price-adjustment');
const roundUp = byId('round-up');
const bulkLaborDiscount = byId('bulk-labor-discount');
const save = byId('save-pricing');
const close = byId('close-admin');
const reload = byId('reload-pricing');
const adminStatus = byId('pricing-admin-status');
const rateInputs = new Map();
const quantities = new Map();
const currency = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
const optionsUnavailable = 'Rounding and bulk discount settings require an update to the pricing service.';
let settings;
let editingRevision = 0;
let loading = false;

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function numberField(labelText, step) {
  const label = element('label', labelText);
  const input = element('input');
  input.type = 'number';
  input.min = '0';
  input.step = step;
  input.inputMode = step === '1' ? 'numeric' : 'decimal';
  label.append(input);
  return {label, input};
}

for (const [key, name] of addOns) {
  const {label, input} = numberField(name, '1');
  input.defaultValue = '0';
  byId('addons').append(label);
  quantities.set(key, input);
}
for (const [group, rates] of rateGroups) {
  const section = element('details');
  const grid = element('div');
  grid.className = 'price-fields';
  for (const [key, name] of rates) {
    const {label, input} = numberField(name, 'any');
    input.required = true;
    input.max = '1000000';
    grid.append(label);
    rateInputs.set(key, input);
  }
  section.append(element('summary', group), grid);
  byId('price-list').append(section);
}

function updateEstimate() {
  byId('screen-options').hidden = item.value !== 'screen';
  const status = byId('quote-status');
  if (!settings) return;
  if (!width.validity.valid || !length.validity.valid) {
    status.textContent = 'Enter a width of 1–72 inches and a length of 1–120 inches.';
    quote.hidden = true;
    return;
  }
  if ([...quantities.values()].some(input => !input.validity.valid)) {
    status.textContent = 'Enter whole, nonnegative add-on quantities.';
    quote.hidden = true;
    return;
  }

  const result = estimate({
    item: item.value, width: width.valueAsNumber || 0, length: length.valueAsNumber || 0,
    material: byId('screen-material').value, frame: byId('frame-material').value,
    bulkPricing: bulkPricing.checked,
    quantities: Object.fromEntries([...quantities].map(([key, input]) => [key, input.valueAsNumber || 0]))
  }, settings);
  byId('quote-labor').textContent = currency.format(result.labor);
  byId('quote-materials').textContent = currency.format(result.materials);
  byId('quote-total').textContent = currency.format(result.total);
  status.textContent = !width.value || !length.value ? 'Enter both dimensions to include material and labor.' : '';
  quote.hidden = false;
}

async function request(action, values) {
  const options = {cache: 'no-store', signal: AbortSignal.timeout(25000)};
  const response = values
    ? await fetch(endpoint, {...options, method: 'POST', body: new URLSearchParams({...values, action, protocol})})
    : await fetch(endpoint + '?action=' + action, options);
  if (!response.ok) throw new Error('Screen pricing is unavailable. Try again.');
  const result = await response.json();
  if (result.protocol !== protocol || result.screenPricing !== true) {
    throw new Error('Screen pricing is unavailable. Try again.');
  }
  return result;
}

function applySettings(saved) {
  settings = {...defaultSettings, ...saved};
  updateEstimate();
}

async function loadPrices() {
  if (loading) return;
  loading = true;
  openAdmin.disabled = true;
  retry.hidden = true;
  try {
    const result = await request('screenPricing');
    if (result.result !== 'success') throw new Error('Prices are unavailable.');
    applySettings(result.settings);
    openAdmin.disabled = false;
  } catch {
    settings = undefined;
    quote.hidden = true;
    byId('quote-status').textContent = 'Prices are unavailable. Try again.';
    retry.hidden = false;
  } finally {
    loading = false;
  }
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', updateEstimate);
form.addEventListener('reset', () => setTimeout(() => {
  updateEstimate();
  width.focus();
}));
byId('swap-dimensions').addEventListener('click', () => {
  [width.value, length.value] = [length.value, width.value];
  updateEstimate();
});
retry.addEventListener('click', loadPrices);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !admin.open) loadPrices();
});

function fillEditor(result) {
  applySettings(result.settings);
  editingRevision = settings.revision;
  adjustment.value = settings.adjustment;
  roundUp.checked = settings.roundUp;
  bulkLaborDiscount.value = settings.bulkLaborDiscount;
  roundUp.disabled = bulkLaborDiscount.disabled = result.screenPricingOptions !== true;
  for (const [key, input] of rateInputs) input.value = settings.rates[key];
  reload.hidden = true;
}

function setBusy(busy) {
  fields.disabled = save.disabled = close.disabled = reload.disabled = busy;
}

openAdmin.addEventListener('click', () => admin.showModal());
close.addEventListener('click', () => admin.close());
admin.addEventListener('cancel', event => {
  if (fields.disabled) event.preventDefault();
});
admin.addEventListener('close', () => {
  settingsForm.reset();
  login.hidden = false;
  edit.hidden = edit.disabled = reload.hidden = true;
  save.textContent = 'Sign in';
  adminStatus.textContent = '';
});
for (const [button, step] of [['decrease', -5], ['increase', 5]]) {
  byId(button).addEventListener('click', () => {
    adjustment.value = Math.max(-100, Math.min(100, (adjustment.valueAsNumber || 0) + step));
  });
}
reload.addEventListener('click', async () => {
  setBusy(true);
  try {
    const result = await request('screenPricing');
    if (result.result !== 'success') throw new Error();
    fillEditor(result);
    adminStatus.textContent = roundUp.disabled ? optionsUnavailable : 'Latest prices loaded.';
  } catch {
    adminStatus.textContent = 'Could not load the latest prices. Try again.';
  } finally {
    setBusy(false);
  }
});
settingsForm.addEventListener('invalid', event => {
  event.target.closest('details')?.setAttribute('open', '');
}, true);

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (fields.disabled) return;
  const editing = !edit.disabled;
  const values = Object.fromEntries(new FormData(settingsForm));
  if (editing) {
    const next = {
      revision: editingRevision, adjustment: adjustment.valueAsNumber,
      rates: Object.fromEntries([...rateInputs].map(([key, input]) => [key, input.valueAsNumber]))
    };
    if (!roundUp.disabled) {
      next.roundUp = roundUp.checked;
      next.bulkLaborDiscount = bulkLaborDiscount.valueAsNumber;
    }
    values.settings = JSON.stringify(next);
  }
  setBusy(true);
  adminStatus.textContent = editing ? 'Saving prices…' : 'Signing in…';
  try {
    const result = await request(editing ? 'saveScreenPricing' : 'screenPricingLogin', values);
    if (result.result !== 'success') {
      reload.hidden = result.result !== 'conflict';
      adminStatus.textContent = result.message || 'Could not load screen pricing.';
      return;
    }
    fillEditor(result);
    login.hidden = true;
    edit.hidden = edit.disabled = false;
    save.textContent = 'Save prices';
    const saved = editing ? 'Prices saved for everyone.' : '';
    adminStatus.textContent = roundUp.disabled ? [saved, optionsUnavailable].filter(Boolean).join(' ') : saved;
  } catch {
    adminStatus.textContent = 'Could not confirm the request. Try again.';
  } finally {
    setBusy(false);
    if (!editing && !edit.hidden) adjustment.focus();
  }
});

loadPrices();
