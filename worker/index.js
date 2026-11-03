const ORIGINS = new Set(['https://mundusmortem.github.io', 'https://ace-tools.bonnylight3.chatgpt.site']);
const encoder = new TextEncoder();
const maxNumber = 1e15;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
}
function problem(message, status = 400) { throw Object.assign(new Error(message), {status}); }
function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function unbase64(text) { return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function secretKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
async function token(env) {
  const body = base64(encoder.encode(JSON.stringify({role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000, nonce: crypto.randomUUID()})));
  return body + '.' + base64(new Uint8Array(await crypto.subtle.sign('HMAC', await secretKey(env), encoder.encode(body))));
}
async function admin(request, env) {
  try {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return false;
    const [body, sig, extra] = auth.slice(7).split('.');
    if (!body || !sig || extra) return false;
    const valid = await crypto.subtle.verify('HMAC', await secretKey(env), unbase64(sig), encoder.encode(body));
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(unbase64(body)));
    return payload.role === 'admin' && Number.isFinite(payload.exp) && payload.exp > Date.now();
  } catch { return false; }
}
async function requireAdmin(request, env) {
  if (!await admin(request, env)) problem('Sign in to build mode.', 401);
}
async function requireViewer(request, env) {
  if (request.headers.get('X-Dashboard-Code') !== env.VIEW_CODE && !await admin(request, env)) problem('Enter the access code.', 401);
}
async function body(request) {
  if (Number(request.headers.get('Content-Length')) > 8192) problem('Request too large.', 413);
  const text = await request.text();
  if (text.length > 8192) problem('Request too large.', 413);
  try { const data = JSON.parse(text); if (!data || typeof data !== 'object' || Array.isArray(data)) problem('Invalid request.'); return data; }
  catch { problem('Invalid request.'); }
}
function cardInput(data) {
  const metric = typeof data.metric === 'string' ? data.metric.trim() : '';
  const category = typeof data.category === 'string' ? data.category.trim() : '';
  if (!metric || metric.length > 100 || category.length > 60) problem('Enter a metric and a category of up to 60 characters.');
  if (typeof data.goal !== 'number' || !Number.isFinite(data.goal) || data.goal <= 0 || data.goal > maxNumber) problem('Goal must be greater than zero.');
  if (typeof data.current !== 'number' || !Number.isFinite(data.current) || Math.abs(data.current) > maxNumber) problem('Enter a valid current number.');
  return {metric, category, goal: data.goal, current: data.current};
}
function version(data) { if (!Number.isInteger(data.version) || data.version < 1) problem('Refresh this card and try again.', 409); return data.version; }
async function api(request, env) {
  if (!env.DB || !env.ADMIN_PASSWORD || !env.VIEW_CODE || !env.SESSION_SECRET) problem('Dashboard is unavailable.', 503);
  const path = new URL(request.url).pathname;
  if (path === '/api/login' && request.method === 'POST') {
    const data = await body(request);
    const window = Math.floor(Date.now() / 900000);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const digest = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(ip + ':' + window))));
    const attempts = await env.DB.prepare('INSERT INTO auth_attempts (key, window, attempts) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(digest, window).first();
    await env.DB.prepare('DELETE FROM auth_attempts WHERE window < ?').bind(window - 1).run();
    if (attempts.attempts > 10) problem('Too many attempts. Try again in 15 minutes.', 429);
    if (data.username !== 'admin' || data.password !== env.ADMIN_PASSWORD) problem('Invalid username or password.', 401);
    return json({token: await token(env)});
  }
  if (path === '/api/dashboard' && request.method === 'GET') {
    await requireViewer(request, env);
    const result = await env.DB.prepare('SELECT * FROM cards ORDER BY created_at, id').all();
    return json({cards: result.results});
  }
  const match = path.match(/^\/api\/cards\/([a-zA-Z0-9-]+)(\/history)?$/);
  if (match?.[2] && request.method === 'GET') {
    await requireViewer(request, env);
    const result = await env.DB.prepare('SELECT id, previous, current, updated_at FROM card_history WHERE card_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 200').bind(match[1]).all();
    return json({history: result.results});
  }
  if (path === '/api/cards' && request.method === 'POST') {
    await requireAdmin(request, env);
    const data = cardInput(await body(request));
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO cards (id, metric, category, goal, current, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, data.metric, data.category, data.goal, data.current, now, now),
      env.DB.prepare('INSERT INTO card_history (id, card_id, current, updated_at) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), id, data.current, now)
    ]);
    return json({card: await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first()}, 201);
  }
  if (match && !match[2] && request.method === 'PATCH') {
    await requireAdmin(request, env);
    const input = await body(request), data = cardInput(input), v = version(input), now = new Date().toISOString();
    const result = await env.DB.batch([
      env.DB.prepare('INSERT INTO card_history (id, card_id, previous, current, updated_at) SELECT ?, id, current, ?, ? FROM cards WHERE id = ? AND version = ? AND current != ?').bind(crypto.randomUUID(), data.current, now, match[1], v, data.current),
      env.DB.prepare('UPDATE cards SET metric = ?, category = ?, goal = ?, previous = CASE WHEN current != ? THEN current ELSE previous END, current = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING *').bind(data.metric, data.category, data.goal, data.current, data.current, now, match[1], v)
    ]);
    const card = result[1].results[0];
    if (!card) problem('Card changed. Refresh and try again.', 409);
    return json({card});
  }
  if (match && !match[2] && request.method === 'DELETE') {
    await requireAdmin(request, env);
    const v = version(await body(request));
    const result = await env.DB.batch([
      env.DB.prepare('DELETE FROM card_history WHERE card_id = ? AND EXISTS (SELECT 1 FROM cards WHERE id = ? AND version = ?)').bind(match[1], match[1], v),
      env.DB.prepare('DELETE FROM cards WHERE id = ? AND version = ? RETURNING id').bind(match[1], v)
    ]);
    if (!result[1].results.length) problem('Card changed. Refresh and try again.', 409);
    return json({deleted: true});
  }
  problem('Not found.', 404);
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return staticResponse(request);
    const origin = request.headers.get('Origin');
    if (origin && !ORIGINS.has(origin)) return json({error: 'Origin not allowed.'}, 403);
    let response;
    try {
      if (request.method === 'OPTIONS') response = new Response(null, {status: 204});
      else response = await api(request, env);
    } catch (error) {
      if (!error.status) console.error('Dashboard request failed:', error.message);
      response = json({error: error.status ? error.message : 'Unable to save or load the dashboard. Try again.'}, error.status || 500);
    }
    const headers = new Headers(response.headers);
    headers.set('Vary', 'Origin');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (origin && ORIGINS.has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dashboard-Code');
      headers.set('Access-Control-Max-Age', '600');
    }
    return new Response(response.body, {status: response.status, headers});
  }
};
// Static files are embedded by scripts/build-worker.py in the published Worker.
function staticResponse(request) {
  let path = new URL(request.url).pathname;
  if (path.endsWith('/')) path += 'index.html';
  const assets = typeof SITE_ASSETS === 'undefined' ? {} : SITE_ASSETS;
  if (!assets[path] && assets[path + '/index.html']) return Response.redirect(new URL(path + '/', request.url), 308);
  const asset = assets[path];
  if (!asset) return new Response('Not found.', {status: 404});
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed.', {status: 405});
  return new Response(request.method === 'HEAD' ? null : asset.body, {headers: {'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'}});
}
