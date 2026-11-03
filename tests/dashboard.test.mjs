import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker/index.js';
import {progress, orderedCards} from '../dist/higher-ground-dashboard/model.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0000_dashboard.sql', import.meta.url), 'utf8'));
  class Statement {
    constructor(query, args = []) { this.query = query; this.args = args; }
    bind(...args) { return new Statement(this.query, args); }
    async first() { return sql.prepare(this.query).get(...this.args) || null; }
    async all() { return {results: sql.prepare(this.query).all(...this.args)}; }
    async run() { const result = sql.prepare(this.query).run(...this.args); return {success: true, meta: {changes: result.changes}}; }
  }
  const env = {
    DB: {
      prepare(query) { return new Statement(query); },
      async batch(statements) {
        sql.exec('BEGIN');
        try {
          const result = [];
          for (const item of statements) result.push(/RETURNING/i.test(item.query) ? await item.all() : await item.run());
          sql.exec('COMMIT'); return result;
        } catch (error) { sql.exec('ROLLBACK'); throw error; }
      }
    },
    ADMIN_PASSWORD: 'test-admin-password', VIEW_CODE: 'test-view-code', SESSION_SECRET: 'test-signing-secret-only',
  };
  async function request(path, {method = 'GET', token, code, data, origin = 'https://mundusmortem.github.io', headers = {}} = {}) {
    if (token) headers.Authorization = 'Bearer ' + token;
    if (code) headers['X-Dashboard-Code'] = code;
    if (origin) headers.Origin = origin;
    if (data) headers['Content-Type'] = 'application/json';
    const response = await worker.fetch(new Request('https://ace-tools.bonnylight3.chatgpt.site' + path, {method, headers, body: data ? JSON.stringify(data) : undefined}), env);
    return {status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json()};
  }
  async function login() { const r = await request('/api/login', {method: 'POST', data: {username: 'admin', password: env.ADMIN_PASSWORD}}); assert.equal(r.status, 200); return r.data.token; }
  return {request, login, env, sql};
}
const input = {metric: 'Orders', category: 'Sales', goal: 100, current: 35};
test('viewer gate is server-side, exact and case-sensitive', async () => {
  const {request, env} = fixture();
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/api/dashboard', {code: env.VIEW_CODE.toUpperCase()})).status, 401);
  const r = await request('/api/dashboard', {code: env.VIEW_CODE});
  assert.equal(r.status, 200); assert.deepEqual(r.data.cards, []);
});
test('admin authentication, forged sessions and unauthorized writes', async () => {
  const {request} = fixture();
  assert.equal((await request('/api/login', {method: 'POST', data: {username: 'admin', password: 'wrong'}})).status, 401);
  assert.equal((await request('/api/cards', {method: 'POST', data: input})).status, 401);
  assert.equal((await request('/api/cards', {method: 'POST', token: 'forged.signature', data: input})).status, 401);
});
test('shared persistence, previous values, history and category edits', async () => {
  const {request, login, env} = fixture(); const token = await login();
  const create = await request('/api/cards', {method: 'POST', token, data: input});
  assert.equal(create.status, 201); const card = create.data.card;
  assert.equal(card.previous, null);
  const visitor = await request('/api/dashboard', {code: env.VIEW_CODE});
  assert.equal(visitor.data.cards[0].current, 35);
  const updated = await request('/api/cards/' + card.id, {method: 'PATCH', token, data: {...input, version: 1, current: 115}});
  assert.equal(updated.data.card.previous, 35); assert.equal(updated.data.card.version, 2);
  const recategorized = await request('/api/cards/' + card.id, {method: 'PATCH', token, data: {...input, category: 'Retail', version: 2, current: 115}});
  assert.equal(recategorized.data.card.previous, 35);
  const history = await request('/api/cards/' + card.id + '/history', {code: env.VIEW_CODE});
  assert.equal(history.data.history.length, 2); assert.equal(history.data.history[0].previous, 35);
  const updatedVisitor = await request('/api/dashboard', {code: env.VIEW_CODE});
  assert.equal(updatedVisitor.data.cards[0].current, 115); assert.equal(updatedVisitor.data.cards[0].category, 'Retail');
});
test('stale edits/deletes do not corrupt values or history', async () => {
  const {request, login, env} = fixture(); const token = await login();
  const {data: {card}} = await request('/api/cards', {method: 'POST', token, data: input});
  await request('/api/cards/' + card.id, {method: 'PATCH', token, data: {...input, version: 1, current: 90}});
  assert.equal((await request('/api/cards/' + card.id, {method: 'PATCH', token, data: {...input, version: 1, current: 50}})).status, 409);
  assert.equal((await request('/api/cards/' + card.id, {method: 'DELETE', token, data: {version: 1}})).status, 409);
  const history = await request('/api/cards/' + card.id + '/history', {code: env.VIEW_CODE}); assert.equal(history.data.history.length, 2);
  assert.equal((await request('/api/cards/' + card.id, {method: 'DELETE', token, data: {version: 2}})).status, 200);
  assert.deepEqual((await request('/api/dashboard', {code: env.VIEW_CODE})).data.cards, []);
  assert.deepEqual((await request('/api/cards/' + card.id + '/history', {code: env.VIEW_CODE})).data.history, []);
});
test('numeric validation rejects zero goals, missing values, huge values and malformed categories', async () => {
  const {request, login} = fixture(); const token = await login();
  for (const changes of [{goal: 0}, {current: null}, {current: '1'}, {metric: ''}, {category: 'a'.repeat(61)}, {goal: 1e20}]) {
    assert.equal((await request('/api/cards', {method: 'POST', token, data: {...input, ...changes}})).status, 400);
  }
});
test('allowed origins receive CORS headers, foreign origins are rejected', async () => {
  const {request} = fixture();
  const preflight = await request('/api/cards', {method: 'OPTIONS'});
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://mundusmortem.github.io');
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal((await request('/api/dashboard', {origin: 'https://unrelated.example'})).status, 403);
});
test('failed logins are rate limited', async () => {
  const {request} = fixture();
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/login', {method: 'POST', data: {username: 'admin', password: 'wrong'}})).status, 401);
  assert.equal((await request('/api/login', {method: 'POST', data: {username: 'admin', password: 'wrong'}})).status, 429);
});
test('progress discs distinguish below, at and above goal and show real changes', () => {
  assert.deepEqual(progress({goal: 100, current: 120, previous: 90}), {percentage: 120, arc: 1, overage: .19999999999999996, exceeded: true, reached: true, delta: 30});
  const at = progress({goal: 100, current: 100, previous: 100}); assert.equal(at.exceeded, false); assert.equal(at.reached, true); assert.equal(at.delta, 0);
  const below = progress({goal: 100, current: -10, previous: 10}); assert.equal(below.arc, 0); assert.equal(below.delta, -20);
});
test('in-progress cards sort before completed cards, categories filter accurately', () => {
  const cards = [{id:'a',current:110,goal:100,category:'Sales',created_at:'1'}, {id:'b',current:25,goal:100,category:'Sales',created_at:'2'}, {id:'c',current:50,goal:100,category:'Other',created_at:'3'}];
  assert.deepEqual(orderedCards(cards).map(c=>c.id), ['c','b','a']);
  assert.deepEqual(orderedCards(cards,'Sales').map(c=>c.id), ['b','a']);
});
