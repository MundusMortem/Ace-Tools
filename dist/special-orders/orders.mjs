import {openScanner} from '../scanner/app.mjs?v=3';

const endpoint = 'https://script.google.com/macros/s/AKfycbxAYm8bwE5nCOcJ0HPTexh5twHfs3geMOBqyRwRCSvdoPvlpkwyyXv63EQoVQ4XRzJI/exec';
const protocol = 'ace-special-orders-v1';
const byId = id => document.getElementById(id);
const form = byId('order-form');
const fields = byId('order-fields');
const orderType = byId('order-type');
const customerFields = byId('customer-fields');
const sku = byId('order-sku');
const description = byId('order-description');
const send = byId('send-order');
const startAnother = byId('new-order');
let scannedTitle = '';
let pendingOrder;
let sending = false;

function notice(id, message = '', kind = '') {
  const status = byId(id);
  status.textContent = message;
  status.className = 'order-status' + (kind ? ' order-' + kind : '');
}

async function post(action, fields) {
  const options = () => ({cache: 'no-store', signal: AbortSignal.timeout(25000)});
  const ready = await fetch(endpoint + '?action=status', options())
    .then(response => response.ok && response.json())
    .catch(() => null);
  if (ready?.protocol !== protocol || ready.result !== 'success') {
    return {result: 'offline', message: 'Special Orders is unavailable. Try again later.'};
  }

  const body = new URLSearchParams({...fields, action, protocol});
  const response = await fetch(endpoint, {...options(), method: 'POST', body});
  if (!response.ok) throw new Error('Order service unavailable');
  const data = await response.json();
  if (data.protocol !== protocol) throw new Error('Unexpected order service response');
  return data;
}

function updateOrderType() {
  const customerOrder = orderType.value === 'CUSTOMER';
  customerFields.hidden = !customerOrder;
  customerFields.disabled = !customerOrder;
}

orderType.addEventListener('change', updateOrderType);
updateOrderType();
send.disabled = false;

byId('order-scan').addEventListener('click', () => {
  openScanner((number, title) => {
    sku.value = number;
    if (!description.value.trim() || description.value === scannedTitle) {
      scannedTitle = title?.trim() ?? '';
      description.value = scannedTitle;
    }
    sku.focus();
    notice('order-scan-status', 'Ace SKU ' + number + ' loaded.', 'success');
  });
});

sku.addEventListener('input', () => notice('order-scan-status'));

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !startAnother.hidden) return;
  if (!pendingOrder) {
    for (const field of fields.querySelectorAll('input:not([type=number]), textarea')) {
      if (!field.matches(':disabled')) field.value = field.value.trim();
    }
    if (!form.reportValidity()) return;
    const order = Object.fromEntries(new FormData(form));
    if (order.orderType === 'CUSTOMER') order.quantity = String(byId('order-quantity').valueAsNumber);
    pendingOrder = {...order, requestId: Date.now() + '-' + crypto.randomUUID()};
  }

  const hadUnconfirmedAttempt = fields.disabled;
  sending = fields.disabled = send.disabled = true;
  notice('order-status', 'Sending order…');
  let needsReview = false;

  try {
    const result = await post('submitOrder', pendingOrder);
    if (result.result === 'success') {
      form.reset();
      scannedTitle = '';
      updateOrderType();
      pendingOrder = undefined;
      send.hidden = true;
      startAnother.hidden = false;
      notice('order-scan-status');
      notice('order-status', 'Order sent.', 'success');
      startAnother.focus();
      return;
    }
    if (result.result === 'error' || (result.result === 'offline' && !hadUnconfirmedAttempt)) {
      pendingOrder = undefined;
      fields.disabled = false;
      send.textContent = 'Send order';
      notice('order-status', result.message, 'error');
      return;
    }
    if (result.result === 'uncertain') {
      needsReview = true;
      notice('order-status', result.message, 'error');
      return;
    }
    notice('order-status', result.message || 'Delivery could not be confirmed. Retry this order to check its status.', 'error');
    send.textContent = 'Retry this order';
  } catch {
    send.textContent = 'Retry this order';
    notice('order-status', 'Delivery could not be confirmed. Retry this order to check its status.', 'error');
  } finally {
    sending = false;
    send.disabled = needsReview || !startAnother.hidden;
  }
});

startAnother.addEventListener('click', () => {
  fields.disabled = send.hidden = send.disabled = false;
  startAnother.hidden = true;
  send.textContent = 'Send order';
  notice('order-status');
  orderType.focus();
});

const admin = byId('order-admin');
const adminForm = byId('order-admin-form');
const adminFields = byId('order-admin-fields');
const login = byId('order-login');
const recipientFields = byId('order-recipient-fields');
const recipients = byId('order-recipients');
const save = byId('save-order-admin');

byId('open-order-admin').addEventListener('click', () => admin.showModal());
byId('close-order-admin').addEventListener('click', () => admin.close());
admin.addEventListener('cancel', event => {
  if (adminFields.disabled) event.preventDefault();
});
admin.addEventListener('close', () => {
  adminForm.reset();
  login.hidden = false;
  recipientFields.hidden = recipientFields.disabled = true;
  save.textContent = 'Sign in';
  notice('order-admin-status');
});

adminForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (adminFields.disabled) return;
  const editing = !recipientFields.disabled;
  const values = Object.fromEntries(new FormData(adminForm));
  const close = byId('close-order-admin');
  adminFields.disabled = save.disabled = close.disabled = true;
  notice('order-admin-status', editing ? 'Saving…' : 'Signing in…');
  let signedIn = false;

  try {
    const result = await post(editing ? 'saveRecipients' : 'getRecipients', values);
    if (result.result !== 'success') {
      notice('order-admin-status', result.message || 'Could not reach the order service.', 'error');
      return;
    }
    recipients.value = result.recipients.join('\n');
    login.hidden = true;
    recipientFields.hidden = recipientFields.disabled = false;
    save.textContent = 'Save recipients';
    notice('order-admin-status', editing ? 'Recipients saved for everyone.' : '', 'success');
    signedIn = !editing;
  } catch {
    notice('order-admin-status', 'Could not confirm the change. Try again.', 'error');
  } finally {
    adminFields.disabled = save.disabled = close.disabled = false;
    if (signedIn) recipients.focus();
  }
});
