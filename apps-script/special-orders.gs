const ORDER_PROTOCOL = 'ace-special-orders-v1';
const ORDER_PREFIX = 'specialOrder.request.';
const ORDER_WINDOW = 48 * 60 * 60 * 1000;
const ORDER_LIMIT = 1500;
const RECIPIENTS_KEY = 'SPECIAL_ORDER_RECIPIENTS';
const PASSWORD_KEY = 'SPECIAL_ORDER_ADMIN_PASSWORD';
const ATTEMPTS_KEY = 'specialOrder.adminAttempts';

function doGet(e) {
  if (e.parameter.action !== 'status') return orderResponse({result: 'error'});
  const ready = readRecipients(PropertiesService.getScriptProperties()).length > 0;
  return orderResponse({result: ready ? 'success' : 'error'});
}

function doPost(e) {
  const data = e.parameter;
  if (data.protocol !== ORDER_PROTOCOL) return orderResponse(orderError('Unsupported order form.'));
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return orderResponse({result: 'retry', message: 'The order service is busy. Try again.'});
  try {
    const properties = PropertiesService.getScriptProperties();
    switch (data.action) {
      case 'submitOrder': return orderResponse(sendOrder(data, properties));
      case 'getRecipients':
      case 'saveRecipients': return orderResponse(editRecipients(data, properties));
      default: return orderResponse(orderError('Unsupported action.'));
    }
  } catch (_) {
    return orderResponse({result: 'retry', message: 'The order service could not complete the request. Try again.'});
  } finally {
    lock.releaseLock();
  }
}

function orderResponse(value) {
  return ContentService.createTextOutput(JSON.stringify({protocol: ORDER_PROTOCOL, ...value}))
    .setMimeType(ContentService.MimeType.JSON);
}

function orderError(message) {
  return {result: 'error', message};
}

function readRecipients(properties) {
  return parseRecipients(properties.getProperty(RECIPIENTS_KEY) || '') || [];
}

function parseRecipients(value) {
  const addresses = [...new Set(value.split(/[\n,]/).map(email => email.trim().toLowerCase()).filter(Boolean))];
  const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
  if (!addresses.length || addresses.length > 20 ||
      addresses.some(email => email.length > 254 || !emailPattern.test(email))) return null;
  return addresses;
}

function editRecipients(data, properties) {
  const password = properties.getProperty(PASSWORD_KEY);
  if (!password) return orderError('Recipient editing is unavailable.');
  const now = Date.now();
  const previous = JSON.parse(properties.getProperty(ATTEMPTS_KEY) || 'null');
  const attempts = previous?.until > now ? previous : {count: 0, until: now + 5 * 60 * 1000};
  if (attempts.count >= 5) return orderError('Too many sign-in attempts. Try again in a few minutes.');

  if (data.username !== 'admin' || data.password !== password) {
    attempts.count++;
    properties.setProperty(ATTEMPTS_KEY, JSON.stringify(attempts));
    return orderError('Incorrect username or password.');
  }
  if (previous) properties.deleteProperty(ATTEMPTS_KEY);
  if (data.action === 'getRecipients') return {result: 'success', recipients: readRecipients(properties)};

  const recipients = parseRecipients(data.recipients || '');
  if (!recipients) return orderError('Enter between 1 and 20 valid email addresses, one per line.');
  properties.setProperty(RECIPIENTS_KEY, recipients.join(','));
  return {result: 'success', recipients};
}

function sendOrder(data, properties) {
  const now = Date.now();
  const requestId = data.requestId || '';
  if (!/^\d{13}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId)) {
    return orderError('Missing or invalid order reference.');
  }
  const requestTime = Number(requestId.slice(0, 13));
  if (requestTime > now + 5 * 60 * 1000) return orderError('Check the date and time on this device.');
  const review = {result: 'uncertain', message: 'Delivery could not be confirmed. Check with the recipient before placing this order again.'};
  if (now - requestTime > ORDER_WINDOW) return review;
  const key = ORDER_PREFIX + requestId;
  const previous = properties.getProperty(key);
  if (previous === 'sent') return {result: 'success'};
  if (previous === 'pending') return review;

  const stock = data.orderType === 'STOCK';
  if (!stock && data.orderType !== 'CUSTOMER') return orderError('Select a valid order type.');
  const name = (data.yourName || '').trim();
  const sku = (data.skuModel || '').trim();
  const quantity = (data.quantity || '').trim();
  const description = (data.description || '').trim();
  const contact = (data.customerInfo || '').trim();
  if (!name || name.length > 100 || !sku || sku.length > 100) {
    return orderError('Enter your name and the Ace SKU or model number.');
  }
  if (!stock && (!/^[0-9]{1,6}$/.test(quantity) || Number(quantity) < 1 ||
      !description || description.length > 2000 || !contact || contact.length > 500)) {
    return orderError('Enter a whole-number quantity, description or notes, and customer name and contact info.');
  }

  const recipients = readRecipients(properties);
  if (!recipients.length) return orderError('Order recipients have not been configured.');
  if (MailApp.getRemainingDailyQuota() < recipients.length) {
    return orderError('The order service has reached its daily email limit. Try again later.');
  }
  let active = 0;
  for (const savedKey of properties.getKeys()) {
    if (!savedKey.startsWith(ORDER_PREFIX)) continue;
    if (now - Number(savedKey.slice(ORDER_PREFIX.length, ORDER_PREFIX.length + 13)) > ORDER_WINDOW) {
      properties.deleteProperty(savedKey);
    } else {
      active++;
    }
  }
  if (active >= ORDER_LIMIT) return orderError('The order service has reached its submission limit. Try again later.');

  const subject = stock ? 'New STOCK Order' :
    contact.split(/[\r\n]/)[0].slice(0, 180) + ' Special Order';
  const lines = ['New ' + data.orderType + ' Order:', '', 'Order Placed By: ' + name, 'SKU/Model Number: ' + sku];
  if (stock) lines.push('Order for STOCK. Check QOH.');
  else lines.push('Quantity: ' + quantity, 'Description/Notes: ' + description, 'Customer Contact: ' + contact);

  // Reserve before sending. Keep the reservation if delivery cannot be confirmed.
  properties.setProperty(key, 'pending');
  try {
    MailApp.sendEmail({to: recipients.join(','), subject, body: lines.join('\n')});
    properties.setProperty(key, 'sent');
    return {result: 'success'};
  } catch (_) {
    return review;
  }
}
