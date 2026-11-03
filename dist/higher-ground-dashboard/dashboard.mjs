import {progress, orderedCards} from './model.mjs';
const API = 'https://ace-tools.bonnylight3.chatgpt.site';
const $ = id => document.getElementById(id);
const num = value => new Intl.NumberFormat(undefined, {maximumFractionDigits: 2}).format(value);
const signed = value => (value > 0 ? '+' : '') + num(value);
const storage = {
  get(key) { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } },
  set(key, value) { try { value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch {} }
};
let viewCode = storage.get('hg-view-code'), adminToken = storage.get('hg-admin-token');
let cards = [], unlocked = false, editing = null, filter = '*', loading = false, revision = 0;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notify(text = '', success = false) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
  $('notice').classList.toggle('success', success);
}
async function api(path, options = {}) {
  const headers = {'Content-Type': 'application/json', ...options.headers};
  if (adminToken) headers.Authorization = 'Bearer ' + adminToken;
  if (viewCode) headers['X-Dashboard-Code'] = viewCode;
  let response;
  try { response = await fetch(API + path, {...options, headers, cache: 'no-store'}); }
  catch { throw new Error('Cannot connect. Try again.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Cannot connect. Try again.'); }
  if (!response.ok) {
    const error = Object.assign(new Error(data.error || 'Unable to save. Try again.'), {status: response.status});
    if (response.status === 401 && path !== '/api/login') {
      adminToken = ''; storage.set('hg-admin-token', ''); updateMode();
      if (!viewCode) lock();
    }
    throw error;
  }
  return data;
}
function placeholders() {
  $('cards').replaceChildren(...Array.from({length: 3}, () => element('div', 'metric-card skeleton')));
  $('empty').hidden = true;
}
function updateMode() {
  $('build-button').textContent = adminToken ? 'Exit build mode' : 'Build mode';
  $('build-label').hidden = !adminToken;
  $('add-card').hidden = !adminToken;
}
function setUnlocked(value) {
  unlocked = value;
  const content = $('dashboard-content');
  content.classList.toggle('is-locked', !value);
  content.inert = !value;
  content.setAttribute('aria-hidden', String(!value));
  $('unlock-form').hidden = value;
  $('lock-button').hidden = !value;
}
function lock() {
  ++revision;
  viewCode = ''; adminToken = ''; cards = [];
  storage.set('hg-view-code', ''); storage.set('hg-admin-token', '');
  setUnlocked(false); updateMode(); placeholders();
  $('access-code').value = ''; $('unlock-error').textContent = ''; notify();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
async function refresh({silent = false} = {}) {
  if (loading) return;
  loading = true;
  const requestedRevision = revision;
  try {
    const data = await api('/api/dashboard');
    if (requestedRevision !== revision) return;
    cards = data.cards; setUnlocked(true); render();
    if (!silent) notify();
  } catch (error) {
    if (requestedRevision !== revision) return;
    if (error.status === 401) {
      lock(); $('unlock-error').textContent = 'Enter the access code.';
    } else if (unlocked) notify(error.message);
    else $('unlock-error').textContent = error.message;
    throw error;
  } finally { loading = false; }
}
function ring(p, metric) {
  const disc = element('div', 'disc');
  disc.setAttribute('role', 'img');
  disc.setAttribute('aria-label', `${metric}: ${num(p.percentage)}% of goal`);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 220 220'); svg.setAttribute('aria-hidden', 'true');
  function circle(radius, cls, fraction) {
    const node = document.createElementNS(ns, 'circle');
    for (const [key, value] of Object.entries({cx: 110, cy: 110, r: radius, class: cls})) node.setAttribute(key, value);
    if (fraction !== undefined) {
      const length = 2 * Math.PI * radius;
      node.setAttribute('stroke-dasharray', `${fraction * length} ${length}`);
      if (fraction <= 0) node.setAttribute('visibility', 'hidden');
    }
    svg.append(node);
  }
  circle(100, 'disc-ticks'); circle(85, 'disc-track'); circle(73, 'disc-inner');
  circle(85, 'disc-progress', p.arc); circle(94, 'disc-extra', p.overage);
  disc.append(svg);
  const label = element('div', 'disc-label');
  const percentage = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0, notation: Math.abs(p.percentage) > 9999 ? 'compact' : 'standard'}).format(p.percentage) + '%';
  label.append(element('strong', percentage.length > 5 ? 'small' : '', percentage), element('span', '', p.exceeded ? 'Exceeded' : p.reached ? 'At goal' : 'In progress'));
  disc.append(label); return disc;
}
function render() {
  updateMode();
  const activeElement = document.activeElement;
  const focusedCard = activeElement?.closest('.metric-card')?.dataset.id;
  const focusedAction = activeElement?.dataset.action;
  const categories = [...new Set(cards.map(card => card.category))].sort((a,b) => a.localeCompare(b));
  if (filter !== '*' && !categories.includes(filter)) filter = '*';
  $('category-filter').replaceChildren(new Option('All categories', '*'), ...categories.map(category => new Option(category || 'Uncategorized', category)));
  $('category-filter').value = filter;
  $('categories').replaceChildren(...categories.filter(Boolean).map(category => { const option = document.createElement('option'); option.value = category; return option; }));
  const sorted = orderedCards(cards, filter);
  $('cards').replaceChildren();
  $('empty').hidden = !!sorted.length;
  $('empty').textContent = filter === '*' ? 'No cards yet.' : 'No cards in this category.';
  for (const card of sorted) {
    const p = progress(card);
    const article = element('article', `metric-card${p.reached ? ' reached' : ''}${p.exceeded ? ' exceeded' : ''}`);
    article.dataset.id = card.id;
    const top = element('div', 'card-top'), heading = element('div');
    heading.append(element('p', 'card-category', card.category || 'Uncategorized'), element('h2', '', card.metric));
    top.append(heading);
    if (adminToken) {
      const edit = element('button', 'icon-button edit-card', '✎');
      edit.type = 'button'; edit.dataset.action = 'edit'; edit.setAttribute('aria-label', 'Edit ' + card.metric); edit.title = 'Edit card';
      edit.addEventListener('click', () => openCard(card)); top.append(edit);
    }
    const values = element('dl', 'metric-values');
    for (const [name, value] of [['Current', card.current], ['Goal', card.goal]]) {
      const block = element('div'); block.append(element('dt', '', name), element('dd', '', num(value))); values.append(block);
    }
    const bottom = element('div', 'card-bottom');
    const delta = element('div', 'delta' + (p.delta > 0 ? ' positive' : p.delta < 0 ? ' negative' : ''), p.delta == null ? '—' : `${p.delta > 0 ? '↗ ' : p.delta < 0 ? '↘ ' : ''}${signed(p.delta)}`);
    delta.append(element('span', 'previous', card.previous == null ? 'No previous number' : 'Previous ' + num(card.previous)));
    const history = element('button', 'history-button', 'History'); history.type = 'button'; history.dataset.action = 'history';
    history.setAttribute('aria-label', 'History for ' + card.metric); history.addEventListener('click', () => openHistory(card));
    bottom.append(delta, history);
    article.append(top, ring(p, card.metric), values, bottom); $('cards').append(article);
  }
  if (focusedCard && focusedAction) {
    const target = [...$('cards').children].find(card => card.dataset.id === focusedCard)?.querySelector(`[data-action="${focusedAction}"]`);
    target?.focus({preventScroll: true});
  }
}
function openCard(card = null) {
  editing = card ? {...card} : null;
  $('card-dialog-title').textContent = card ? 'Edit card' : 'Add card';
  $('metric').value = card?.metric || ''; $('category').value = card?.category ?? (filter === '*' ? '' : filter);
  $('goal').value = card?.goal ?? ''; $('current').value = card?.current ?? '';
  $('delete-card').hidden = !card; $('card-error').textContent = '';
  $('card-dialog').showModal();
}
async function openHistory(card) {
  $('history-title').textContent = card.metric;
  $('history-content').textContent = 'Loading…'; $('history-dialog').showModal();
  try {
    const {history} = await api(`/api/cards/${card.id}/history`);
    const list = element('ol', 'history-list');
    for (const row of history) {
      const item = element('li', 'history-row'), detail = element('div');
      detail.append(element('span', 'history-value', num(row.current)));
      const time = element('time', '', new Date(row.updated_at).toLocaleString()); time.dateTime = row.updated_at; detail.append(time);
      const delta = row.previous == null ? null : row.current - row.previous;
      const change = element('span', 'history-change' + (delta > 0 ? ' positive' : delta < 0 ? ' negative' : ''), delta == null ? 'Initial' : signed(delta));
      item.append(detail, change); list.append(item);
    }
    $('history-content').replaceChildren(history.length ? list : element('p', '', 'No history yet.'));
  } catch (error) { $('history-content').textContent = error.message; }
}
async function busy(form, fn, errorId) {
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => button.disabled = true);
  $(errorId).textContent = '';
  try { await fn(); }
  catch (error) { $(errorId).textContent = error.message; if (error.status === 409) refresh({silent: true}).catch(() => {}); }
  finally { buttons.forEach(button => button.disabled = false); }
}
$('unlock-form').addEventListener('submit', event => {
  event.preventDefault();
  if (loading) return;
  viewCode = $('access-code').value; ++revision;
  busy(event.currentTarget, async () => {
    try { await refresh(); storage.set('hg-view-code', viewCode); $('access-code').value = ''; }
    catch (error) { if (error.status === 401) error.message = 'Invalid access code.'; throw error; }
  }, 'unlock-error');
});
$('access-code').addEventListener('input', () => { $('unlock-error').textContent = ''; if ($('access-code').value === 'stv') $('unlock-form').requestSubmit(); });
$('build-button').addEventListener('click', () => {
  if (adminToken) {
    adminToken = ''; storage.set('hg-admin-token', '');
    if (!viewCode) lock(); else { updateMode(); render(); }
    return;
  }
  $('login-error').textContent = ''; $('login-dialog').showModal();
});
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(event.currentTarget, async () => {
    const data = await api('/api/login', {method: 'POST', body: JSON.stringify({username: $('username').value, password: $('password').value})});
    adminToken = data.token; storage.set('hg-admin-token', adminToken); ++revision;
    await refresh(); $('login-dialog').close(); $('password').value = ''; $('login-form').reset();
  }, 'login-error');
});
$('lock-button').addEventListener('click', () => { lock(); $('access-code').focus(); });
$('add-card').addEventListener('click', () => openCard());
$('category-filter').addEventListener('change', event => { filter = event.target.value; render(); });
$('card-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(event.currentTarget, async () => {
    const data = {metric: $('metric').value, category: $('category').value, goal: Number($('goal').value), current: Number($('current').value)};
    if (editing) data.version = editing.version;
    const {card} = await api(editing ? `/api/cards/${editing.id}` : '/api/cards', {method: editing ? 'PATCH' : 'POST', body: JSON.stringify(data)});
    cards = cards.filter(item => item.id !== card.id).concat(card);
    if (filter !== '*' && card.category !== filter) filter = card.category;
    ++revision; render(); $('card-dialog').close(); editing = null; notify('Saved.', true);
  }, 'card-error');
});
$('delete-card').addEventListener('click', () => {
  $('delete-name').textContent = editing?.metric || ''; $('delete-error').textContent = ''; $('delete-dialog').showModal();
});
$('delete-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(event.currentTarget, async () => {
    if (!editing) return;
    await api(`/api/cards/${editing.id}`, {method: 'DELETE', body: JSON.stringify({version: editing.version})});
    cards = cards.filter(card => card.id !== editing.id); ++revision; editing = null;
    $('delete-dialog').close(); $('card-dialog').close(); render(); notify('Deleted.', true);
  }, 'delete-error');
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
$('login-dialog').addEventListener('close', () => { $('password').value = ''; });
setInterval(() => { if (unlocked && !document.hidden && !document.querySelector('dialog[open]')) refresh({silent: true}).catch(() => {}); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && unlocked) refresh({silent: true}).catch(() => {}); });
placeholders(); updateMode();
if (viewCode || adminToken) refresh().catch(() => {});
