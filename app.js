'use strict';

/* ============================================================
 * manaba 未提出課題 PWA
 * データはすべて端末内 (localStorage) に保存する。
 * ============================================================ */

const STORAGE_KEY = 'manabaPwa';
const SCHEMA_VERSION = 1;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* ---------- 保存・読み込み ---------- */

function emptyState() {
  // 将来ここに timetable / attendance などを追加していく
  return { version: SCHEMA_VERSION, tasks: [], lastImportAt: null };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    return migrate(s);
  } catch (e) {
    console.error(e);
    return emptyState();
  }
}

function migrate(s) {
  if (!s || typeof s !== 'object') return emptyState();
  if (!Array.isArray(s.tasks)) s.tasks = [];
  // バージョンが上がったらここで変換処理を追加する
  s.version = SCHEMA_VERSION;
  return s;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

/* ---------- 日付ユーティリティ ---------- */

// manaba の "2026-12-01 23:59" 形式(/ 区切りや秒付きも許容)を端末の現地時刻として解釈
function parseManabaDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})日?\s*(?:(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(+y, +mo - 1, +d, h ? +h : 23, mi ? +mi : 59);
  return isNaN(date) ? null : date.getTime();
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDue(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtRemain(ms, now) {
  const diff = ms - now;
  if (diff < 0) return '期限切れ';
  if (diff < HOUR) return `あと${Math.max(1, Math.floor(diff / 60000))}分`;
  if (diff < DAY) return `あと${Math.floor(diff / HOUR)}時間`;
  return `あと${Math.floor(diff / DAY)}日`;
}

function urgency(ms, now) {
  const diff = ms - now;
  if (diff < 0) return 'overdue';
  if (diff <= DAY) return 'urgent';
  if (diff <= 3 * DAY) return 'soon';
  return '';
}

function toLocalInputValue(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/* ---------- 描画 ---------- */

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

function renderTask(t, now) {
  const u = t.done ? '' : urgency(t.end, now);
  const titleNode = t.url
    ? el('a', { class: 'title', href: t.url, target: '_blank', rel: 'noopener' }, t.title)
    : el('span', { class: 'title' }, t.title);

  const badges = [];
  if (t.type) badges.push(el('span', { class: 'badge' }, t.type));
  if (t.source === 'manual') badges.push(el('span', { class: 'badge' }, '手動'));
  if (t.missing && !t.done) badges.push(el('span', { class: 'badge warn' }, 'manabaの一覧にありません(提出済み?)'));

  return el('li', { class: `task ${u} ${t.done ? 'done' : ''}` },
    el('input', {
      type: 'checkbox', class: 'check', checked: t.done, 'aria-label': '完了',
      onchange: (ev) => toggleDone(t.id, ev.target.checked),
    }),
    el('div', { class: 'task-body' },
      badges.length ? el('div', {}, ...badges) : null,
      titleNode,
      t.course ? el('div', { class: 'meta' }, t.course) : null,
      el('div', { class: 'due' },
        '締切 ', fmtDue(t.end),
        t.done ? null : el('span', { class: 'remain' }, fmtRemain(t.end, now)),
      ),
    ),
    el('button', { class: 'del', 'aria-label': '削除', onclick: () => deleteTask(t.id) }, '×'),
  );
}

function render() {
  const now = Date.now();
  const open = state.tasks.filter((t) => !t.done).sort((a, b) => a.end - b.end);
  const done = state.tasks.filter((t) => t.done).sort((a, b) => b.end - a.end);

  $('#list-open').replaceChildren(...open.map((t) => renderTask(t, now)));
  $('#list-done').replaceChildren(...done.map((t) => renderTask(t, now)));

  $('#empty').hidden = open.length > 0;
  $('#done-section').hidden = done.length === 0;
  $('#done-count').textContent = `(${done.length})`;

  const urgent = open.filter((t) => urgency(t.end, now) === 'urgent').length;
  $('#summary').textContent = open.length
    ? `未完了 ${open.length}件` + (urgent ? ` ・ 24時間以内 ${urgent}件` : '')
    : '';
  $('#last-import').textContent = state.lastImportAt
    ? `最終取り込み: ${fmtDue(state.lastImportAt)}`
    : '';
}

/* ---------- 操作 ---------- */

function toggleDone(id, done) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = done;
  t.doneAt = done ? Date.now() : null;
  saveState();
  render();
}

function deleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const note = t.source === 'manaba' && !t.missing
    ? '\n(manabaの一覧に残っている課題は、次に取り込んだときにまた表示されます)'
    : '';
  if (!confirm(`「${t.title}」を削除しますか?${note}`)) return;
  state.tasks = state.tasks.filter((x) => x.id !== id);
  saveState();
  render();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

/* ---------- 手動追加 ---------- */

function openAdd() {
  const f = $('#form-add');
  f.reset();
  // 初期値: 明日の 23:59
  const d = new Date(Date.now() + DAY);
  d.setHours(23, 59, 0, 0);
  f.end.value = toLocalInputValue(d.getTime());
  $('#dlg-add').showModal();
}

$('#form-add').addEventListener('submit', (ev) => {
  if (ev.submitter && ev.submitter.value !== 'ok') return;
  const f = ev.target;
  const end = new Date(f.end.value).getTime();
  if (!f.title.value.trim() || isNaN(end)) return;
  state.tasks.push({
    id: 'm:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    source: 'manual',
    type: '',
    title: f.title.value.trim(),
    course: f.course.value.trim(),
    url: f.url.value.trim(),
    start: null,
    end,
    done: false,
    doneAt: null,
    missing: false,
    addedAt: Date.now(),
  });
  saveState();
  render();
  toast('追加しました');
});

/* ---------- manaba 取り込み ---------- */

// ブックマークレットが作る JSON:
// { app: "manaba-pwa", v: 1, at: "...", items: [{type,title,course,start,end,url}], skipped: n }
function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error('manabaのデータとして読み取れませんでした。ブックマークレットでコピーした内容を貼り付けてください。');
  }
  if (!data || data.app !== 'manaba-pwa' || !Array.isArray(data.items)) {
    throw new Error('manabaのデータではないようです。');
  }
  const items = [];
  let bad = 0;
  for (const it of data.items) {
    const end = parseManabaDate(it.end);
    if (!it.title || end == null) { bad++; continue; }
    items.push({
      key: it.url || `t:${it.title}|${it.course || ''}`,
      type: it.type || '',
      title: String(it.title).trim(),
      course: String(it.course || '').trim(),
      url: it.url || '',
      start: parseManabaDate(it.start),
      end,
    });
  }
  return { items, skipped: (data.skipped || 0) + bad };
}

function planMerge(incoming) {
  const existing = new Map(state.tasks.filter((t) => t.source === 'manaba').map((t) => [t.id, t]));
  const seen = new Set();
  let added = 0, updated = 0;
  for (const it of incoming) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    const t = existing.get(it.key);
    if (!t) added++;
    else if (t.title !== it.title || t.course !== it.course || t.end !== it.end || t.missing) updated++;
  }
  let missing = 0;
  for (const t of existing.values()) {
    if (!seen.has(t.id) && !t.done && !t.missing) missing++;
  }
  return { added, updated, missing };
}

function applyMerge(incoming) {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const seen = new Set();
  for (const it of incoming) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    const t = byId.get(it.key);
    if (t) {
      // 完了状態は保持したまま内容だけ更新
      Object.assign(t, {
        type: it.type, title: it.title, course: it.course, url: it.url,
        start: it.start, end: it.end, missing: false,
      });
    } else {
      state.tasks.push({
        id: it.key, source: 'manaba', type: it.type, title: it.title, course: it.course,
        url: it.url, start: it.start, end: it.end,
        done: false, doneAt: null, missing: false, addedAt: Date.now(),
      });
    }
  }
  // 今回の一覧にない manaba 課題は「一覧にありません」印を付ける(自動完了はしない)
  for (const t of state.tasks) {
    if (t.source === 'manaba' && !seen.has(t.id)) t.missing = true;
  }
  state.lastImportAt = Date.now();
  saveState();
  render();
}

let pendingImport = null;

function previewImport() {
  const text = $('#import-text').value;
  const box = $('#import-preview');
  const applyBtn = $('#btn-import-apply');
  pendingImport = null;
  applyBtn.disabled = true;
  if (!text.trim()) { box.replaceChildren(); return; }
  try {
    const { items, skipped } = parseImport(text);
    const p = planMerge(items);
    pendingImport = items;
    applyBtn.disabled = false;
    box.replaceChildren(
      el('div', {}, `読み取り: ${items.length}件` + (skipped ? `(締切なしなどで除外 ${skipped}件)` : '')),
      el('div', {}, `新規 ${p.added}件 ・ 更新 ${p.updated}件`),
      p.missing ? el('div', {}, `一覧から消えた課題 ${p.missing}件(「一覧にありません」と表示します)`) : null,
    );
  } catch (e) {
    box.replaceChildren(el('div', { class: 'err' }, e.message));
  }
}

function openImport(prefill = '') {
  $('#import-text').value = prefill;
  previewImport();
  $('#dlg-import').showModal();
}

$('#import-text').addEventListener('input', previewImport);

$('#btn-paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    $('#import-text').value = text;
    previewImport();
  } catch {
    toast('貼り付けできませんでした。下の欄を長押しして「ペースト」してください');
    $('#import-text').focus();
  }
});

$('#btn-import-apply').addEventListener('click', () => {
  if (!pendingImport) return;
  const n = pendingImport.length;
  applyMerge(pendingImport);
  pendingImport = null;
  $('#dlg-import').close();
  toast(`${n}件を取り込みました`);
});

// Safari のタブで使う場合: ブックマークレットから app/#import=... で直接開ける
function checkHashImport() {
  const h = location.hash;
  if (!h.startsWith('#import=')) return;
  let text = '';
  try { text = decodeURIComponent(h.slice('#import='.length)); } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname + location.search);
  if (text) openImport(text);
}

/* ---------- 起動 ---------- */

$('#btn-import').addEventListener('click', () => openImport());
$('#btn-add').addEventListener('click', openAdd);

render();
checkHashImport();
window.addEventListener('hashchange', checkHashImport);
setInterval(render, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// テスト用に公開
window.__app = { parseManabaDate, parseImport };
