import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

const script = readFileSync(new URL('../apps-script/special-orders.gs', import.meta.url), 'utf8');
const protocol = 'ace-special-orders-v1';
const requestId = () => Date.now() + '-' + randomUUID();
const order = () => ({orderType: 'STOCK', yourName: 'Employee', skuModel: '0123456', requestId: requestId()});
const admin = {username: 'admin', password: 'test-pin'};

function service() {
  const mail = [];
  const values = new Map([
    ['SPECIAL_ORDER_ADMIN_PASSWORD', admin.password],
    ['SPECIAL_ORDER_RECIPIENTS', 'orders@example.com'],
    ['SPECIAL_ORDER_SENDER', 'sender@example.com']
  ]);
  const properties = {
    getProperty: key => values.get(key),
    setProperty: (key, value) => values.set(key, value),
    deleteProperty: key => values.delete(key),
    getKeys: () => [...values.keys()]
  };
  const context = {
    Session: {getEffectiveUser: () => ({getEmail: () => 'Sender@example.com'})},
    Utilities: {getUuid: randomUUID},
    PropertiesService: {getScriptProperties: () => properties},
    LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock() {}})},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: body => ({setMimeType: () => JSON.parse(body)})},
    MailApp: {getRemainingDailyQuota: () => 50, sendEmail: message => mail.push(message)}
  };
  runInNewContext(script, context);
  return {
    mail, values, context,
    post: (action, data) => context.doPost({parameter: {action, protocol, ...data}})
  };
}

test('stock orders preserve the SKU, include the QOH reminder, and send once per reference', () => {
  const {post, mail} = service();
  const stock = order();
  assert.equal(post('submitOrder', stock).result, 'success');
  assert.equal(post('submitOrder', stock).result, 'success');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].subject, 'New STOCK Order');
  assert.match(mail[0].body, /SKU\/Model Number: 0123456\nOrder for STOCK\. Check QOH\.$/);
});

test('blank fields and invalid quantities fail before sending', () => {
  const {post, mail} = service();
  const customer = {...order(), orderType: 'CUSTOMER', quantity: '2', description: 'Notes', customerInfo: 'Customer\n555-0100'};
  for (const update of [{orderType: ''}, {yourName: '   '}, {skuModel: ''}, {quantity: '0'},
    {quantity: '1.5'}, {description: '\n'}, {customerInfo: ''}, {requestId: ''}, {protocol: ''}]) {
    assert.equal(post('submitOrder', {...customer, ...update}).result, 'error');
  }
  assert.equal(mail.length, 0);
  assert.equal(post('submitOrder', customer).result, 'success');
  assert.match(mail[0].body, /Quantity: 2\nDescription\/Notes: Notes\nCustomer Contact: Customer\n555-0100/);
  assert.equal(mail[0].subject, 'Customer Special Order');
});

test('uncertain delivery retains its reservation and blocks a second email', () => {
  const {post, context, mail} = service();
  context.MailApp.sendEmail = message => {
    mail.push(message);
    throw Error('Lost delivery acknowledgement');
  };
  const stock = order();
  assert.equal(post('submitOrder', stock).result, 'uncertain');
  assert.equal(post('submitOrder', stock).result, 'uncertain');
  assert.equal(mail.length, 1);
});

test('recipient settings are authenticated and shared by later orders', () => {
  const {post, mail} = service();
  assert.equal(post('getRecipients', {username: 'admin', password: 'wrong'}).result, 'error');
  assert.equal(post('saveRecipients', {recipients: 'other@example.com'}).result, 'error');
  assert.equal(post('saveRecipients', {...admin, recipients: 'invalid'}).result, 'error');
  assert.deepEqual(post('getRecipients', admin).recipients, ['orders@example.com']);
  const recipients = 'first@example.com\nSecond@example.com\nfirst@example.com';
  assert.equal(post('saveRecipients', {...admin, recipients}).result, 'success');
  assert.deepEqual(post('getRecipients', admin).recipients, ['first@example.com', 'second@example.com']);
  assert.equal(post('submitOrder', {...order(), recipients: 'spoof@example.com'}).result, 'success');
  assert.equal(mail[0].to, 'first@example.com,second@example.com');
});

test('repeated bad admin credentials are throttled without blocking orders', () => {
  const {post} = service();
  for (let count = 0; count < 5; count++) post('getRecipients', {username: 'admin', password: 'wrong'});
  assert.match(post('getRecipients', admin).message, /Too many/);
  assert.equal(post('submitOrder', order()).result, 'success');
});

test('the GET readiness check is read-only and requires configured recipients', () => {
  const {values, context, mail} = service();
  assert.deepEqual(context.doGet({parameter: {action: 'status'}}), {protocol, result: 'success', senderVerified: true});
  values.delete('SPECIAL_ORDER_RECIPIENTS');
  assert.deepEqual(context.doGet({parameter: {action: 'status'}}), {protocol, result: 'error', senderVerified: true});
  assert.equal(mail.length, 0);
});

test('the original standalone form can still submit valid orders to the same URL', () => {
  const {context, mail} = service();
  const legacy = {orderType: 'STOCK', yourName: 'Employee', skuModel: '0123456', autoFilled: 'Legacy note'};
  assert.equal(context.doPost({parameter: {...legacy, yourName: ' '}}).result, 'error');
  assert.equal(context.doPost({parameter: legacy}).result, 'success');
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, /Order for STOCK\. Check QOH\.$/);
});

test('the backend blocks delivery when the deployment runs as a different or unknown account', () => {
  const {context, post, mail, values} = service();
  for (const email of ['other@example.com', '']) {
    context.Session.getEffectiveUser = () => ({getEmail: () => email});
    assert.equal(context.doGet({parameter: {action: 'status'}}).senderVerified, false);
    assert.equal(post('submitOrder', order()).result, 'error');
  }
  values.delete('SPECIAL_ORDER_SENDER');
  assert.equal(post('submitOrder', order()).result, 'error');
  assert.equal(mail.length, 0);
});
