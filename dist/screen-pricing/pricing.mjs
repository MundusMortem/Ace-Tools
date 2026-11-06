import {addOns, rateGroups, defaultRates, estimate} from './quote.mjs';

const endpoint = 'https://script.google.com/macros/s/AKfycbxAYm8bwE5nCOcJ0HPTexh5twHfs3geMOBqyRwRCSvdoPvlpkwyyXv63EQoVQ4XRzJI/exec';
const protocol = 'ace-special-orders-v1';
const byId = id => document.getElementById(id);
const form = byId('estimate');
const item = byId('item-type');
const width = byId('width');
const length = byId('length');
const quote = byId('quote');
const retry = byId('retry-prices');
const openAdmin = byId('open-admin');
const admin = byId('pricing-admin');
const settingsForm = byId('pricing-settings');
const login = byId('pricing-login');
const edit = byId('pricing-edit');
const fields = byId('settings-fields');
const adjustment = byId('price-adjustment');
const save = byId('save-pricing');
const close = byId('close-admin');
const reload = byId('reload-pricing');
const adminStatus = byId('pricing-admin-status');
const rateInputs = new Map();
const quantities = new Map();
const currency = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'});
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

function row([label, value]) {
  const line = element('div');
  line.append(element('dt', label), element('dd', currency.format(value)));
  return line;
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
    quantities: Object.fromEntries([...quantities].map(([key, input]) => [key, input.valueAsNumber || 0]))
  }, settings.rates);
  const multiplier = 1 + settings.adjustment / 100;
  const total = result.labor + result.materials;
  const totals = [['Base labor', result.labor], ['Base materials', result.materials], ['Base total', total]];
  if (settings.adjustment !== 0) totals.push(['Adjusted labor', result.labor * multiplier],
    ['Adjusted materials', result.materials * multiplier], ['Final total', total * multiplier]);

  const totalRows = totals.map(row);
  totalRows.at(-1).className = 'quote-final';
  byId('quote-totals').replaceChildren(...totalRows);
  const lines = result.lines.filter(([, cost]) => cost > 0);
  byId('quote-breakdown').replaceChildren(...lines.map(row));
  byId('quote-details').hidden = !lines.length;
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
  settings = saved ?? {rates: defaultRates, adjustment: 0, revision: 0};
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
form.addEventListener('reset', () => queueMicrotask(() => {
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

function fillEditor(saved) {
  applySettings(saved);
  editingRevision = settings.revision;
  adjustment.value = settings.adjustment;
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
    fillEditor(result.settings);
    adminStatus.textContent = 'Latest prices loaded.';
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
    values.settings = JSON.stringify({
      revision: editingRevision, adjustment: adjustment.valueAsNumber,
      rates: Object.fromEntries([...rateInputs].map(([key, input]) => [key, input.valueAsNumber]))
    });
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
    fillEditor(result.settings);
    login.hidden = true;
    edit.hidden = edit.disabled = false;
    save.textContent = 'Save prices';
    adminStatus.textContent = editing ? 'Prices saved for everyone.' : '';
  } catch {
    adminStatus.textContent = 'Could not confirm the request. Try again.';
  } finally {
    setBusy(false);
    if (!editing && !edit.hidden) adjustment.focus();
  }
});

loadPrices();
