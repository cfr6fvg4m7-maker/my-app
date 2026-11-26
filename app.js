'use strict';

/* ============================================================
 * manaba 未提出課題 PWA
 * データはすべて端末内 (localStorage) に保存する。
 * ============================================================ */

const STORAGE_KEY = 'manabaPwa';
const SCHEMA_VERSION = 2;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* ---------- 保存・読み込み ---------- */

// 文教大学の時限(あとで設定画面から変えられるよう state に持たせる)
function defaultTimetable() {
  return {
    days: [1, 2, 3, 4, 5, 6], // 月〜土 (Date#getDay と同じ番号)
    periods: [
      { start: '09:10', end: '10:40' },
      { start: '10:50', end: '12:20' },
      { start: '13:10', end: '14:40' },
      { start: '14:50', end: '16:20' },
      { start: '16:30', end: '18:00' },
    ],
    // キーは "曜日-時限" (例: "1-2" = 月曜2限)
    classes: {},
  };
}

function emptyState() {
  // 将来ここに attendance などを追加していく
  return { version: SCHEMA_VERSION, tasks: [], lastImportAt: null, timetable: defaultTimetable() };
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
  // v1 → v2: 時間割を追加
  if (!s.timetable || typeof s.timetable !== 'object') s.timetable = defaultTimetable();
  if (!s.timetable.classes) s.timetable.classes = {};
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
  $('#legend').hidden = open.length === 0;
  $('#done-section').hidden = done.length === 0;
  $('#done-count').textContent = `(${done.length})`;

  const urgent = open.filter((t) => urgency(t.end, now) === 'urgent').length;
  $('#summary').textContent = open.length
    ? `未完了 ${open.length}件` + (urgent ? ` ・ 24時間以内 ${urgent}件` : '')
    : '';
  renderStale(now);
  $('#last-import').textContent = state.lastImportAt
    ? `最終取り込み: ${fmtDue(state.lastImportAt)}`
    : '';
}

// 取り込み忘れのお知らせ(最後の取り込みから1日以上)
const STALE_AFTER = DAY;
function renderStale(now) {
  const box = $('#stale');
  if (!state.lastImportAt) {
    box.textContent = 'まだmanabaから取り込んでいません。上の「① manabaを開く」から、manabaで「manaba取込」→「コピー」をして、「② 取り込む」を押してください。';
    box.hidden = false;
    return;
  }
  const diff = now - state.lastImportAt;
  if (diff < STALE_AFTER) { box.hidden = true; return; }
  const days = Math.floor(diff / DAY);
  box.textContent = `最後の取り込みから${days}日たっています。「① manabaを開く」から新しい課題が出ていないか確認して、取り込みましょう。`;
  box.hidden = false;
}

/* ---------- 操作 ---------- */

function toggleDone(id, done) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = done;
  t.doneAt = done ? Date.now() : null;
  saveState();
  renderAll();
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
  renderAll();
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
  renderAll();
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
  if (data && data.app === 'manaba-pwa' && data.kind === 'timetable' && Array.isArray(data.slots)) {
    const slots = data.slots
      .filter((x) => x && x.day >= 0 && x.day <= 6 && x.period >= 1 && Array.isArray(x.courses) && x.courses.length)
      .map((x) => ({
        day: Number(x.day),
        period: Number(x.period),
        courses: x.courses.filter((c) => c && c.name).map((c) => ({ name: String(c.name).trim(), url: c.url || '' })),
      }))
      .filter((x) => x.courses.length);
    return { kind: 'timetable', slots };
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
  return { kind: 'tasks', items, skipped: (data.skipped || 0) + bad };
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
  renderAll();
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
    const parsed = parseImport(text);
    pendingImport = parsed;
    applyBtn.disabled = false;
    if (parsed.kind === 'timetable') {
      box.replaceChildren(el('div', {}, `時間割: ${parsed.slots.length}コマを読み取りました`),
        el('div', {}, 'manabaから取り込んだ時間割で置き換えます(教室・単位数などの入力は、同じ授業なら残ります)'));
      return;
    }
    const { items, skipped } = parsed;
    const p = planMerge(items);
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
  const parsed = pendingImport;
  pendingImport = null;
  $('#dlg-import').close();
  if (parsed.kind === 'timetable') {
    const n = applyTimetable(parsed.slots);
    toast(`時間割を取り込みました(${n}コマ)`);
    showView('timetable');
    return;
  }
  applyMerge(parsed.items);
  toast(`${parsed.items.length}件を取り込みました`);
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

/* ---------- 時間割 ---------- */

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function classKey(day, period) { return `${day}-${period}`; }

// 授業に結びつく未完了の課題(manabaのコース名が一致、なければ授業名を含むもの)
function classCourseNames(c) {
  if (!c) return [];
  if (Array.isArray(c.courses) && c.courses.length) return c.courses.map((x) => x.name);
  return c.course ? [c.course] : [];
}

function tasksForClass(c) {
  if (!c) return [];
  const names = classCourseNames(c);
  return state.tasks
    .filter((t) => !t.done && t.course && (names.length ? names.includes(t.course) : t.course.includes(c.name)))
    .sort((a, b) => a.end - b.end);
}

// manaba のコース一覧(曜日表示)から取り込んだ時間割を反映する。
// manaba 由来のコマは置き換え、手入力の教室・先生・単位数は同じ授業なら引き継ぐ。
function applyTimetable(slots) {
  const classes = state.timetable.classes;
  const keys = new Set(slots.map((x) => classKey(x.day, x.period)));
  for (const [k, c] of Object.entries(classes)) {
    if (c && c.source === 'manaba' && !keys.has(k)) delete classes[k];
  }
  for (const x of slots) {
    const k = classKey(x.day, x.period);
    const old = classes[k];
    const name = x.courses.map((c) => c.name).join(' / ');
    const same = old && classCourseNames(old).join(' / ') === name;
    classes[k] = {
      name: same && old.name ? old.name : name,
      room: same ? old.room || '' : '',
      teacher: same ? old.teacher || '' : '',
      credits: same ? old.credits ?? null : null,
      course: '',
      courses: x.courses,
      source: 'manaba',
    };
  }
  state.timetable.lastImportAt = Date.now();
  saveState();
  renderAll();
  return slots.length;
}

// 今の時限(授業中)と、今日このあとの授業
function nowInfo(date = new Date()) {
  const tt = state.timetable;
  const day = date.getDay();
  const min = date.getHours() * 60 + date.getMinutes();
  let current = null;
  const upcoming = [];
  if (tt.days.includes(day)) {
    tt.periods.forEach((p, i) => {
      const c = tt.classes[classKey(day, i + 1)];
      if (min >= toMin(p.start) && min < toMin(p.end)) current = { period: i + 1, p, c };
      else if (min < toMin(p.start) && c) upcoming.push({ period: i + 1, p, c });
    });
  }
  return { day, current, next: upcoming[0] || null };
}

function renderTimetable() {
  const tt = state.timetable;
  const now = new Date();
  const { day, current, next } = nowInfo(now);

  // 上部: 今の授業 / 次の授業
  const lines = [];
  if (current && current.c) {
    lines.push(el('div', {}, el('b', {}, `今 ${current.period}限 `), current.c.name,
      current.c.room ? el('span', { class: 'muted' }, `(${current.c.room})`) : null,
      el('span', { class: 'muted' }, ` 〜${current.p.end}`)));
  }
  if (next) {
    lines.push(el('div', {}, el('b', {}, `次 ${next.period}限 `), next.c.name,
      next.c.room ? el('span', { class: 'muted' }, `(${next.c.room})`) : null,
      el('span', { class: 'muted' }, ` ${next.p.start}〜`)));
  }
  if (!lines.length) {
    const any = tt.days.includes(day) && tt.periods.some((_, i) => tt.classes[classKey(day, i + 1)]);
    lines.push(el('div', { class: 'muted' }, any ? '今日の授業はもうありません' : '今日の授業はありません'));
  }
  $('#tt-now').replaceChildren(...lines);

  // 表
  const cells = [el('div', { class: 'tt-corner' })];
  for (const d of tt.days) {
    cells.push(el('div', { class: `tt-head ${d === day ? 'today' : ''}` }, WD[d]));
  }
  tt.periods.forEach((p, i) => {
    const period = i + 1;
    cells.push(el('div', { class: `tt-period ${current && current.period === period ? 'now' : ''}` },
      el('b', {}, period), el('span', {}, p.start), el('span', {}, p.end)));
    for (const d of tt.days) {
      const c = tt.classes[classKey(d, period)];
      const isNow = d === day && current && current.period === period;
      const n = tasksForClass(c).length;
      cells.push(el('button', {
        class: `tt-cell ${c ? 'filled' : ''} ${d === day ? 'today' : ''} ${isNow ? 'now' : ''}`,
        'aria-label': `${WD[d]}曜${period}限 ${c ? c.name : '空き'}`,
        onclick: () => openClass(d, period),
      },
        ...(c ? (c.courses && c.courses.length > 1 && !c.nameEdited
          ? c.courses.map((x) => el('span', { class: 'tt-name' }, x.name))
          : [el('span', { class: 'tt-name' }, c.name)]) : []),
        c && c.room ? el('span', { class: 'tt-room' }, c.room) : null,
        n ? el('span', { class: 'tt-badge' }, `課題${n}`) : null,
      ));
    }
  });
  const grid = $('#tt-grid');
  grid.style.gridTemplateColumns = `34px repeat(${tt.days.length}, minmax(0, 1fr))`;
  grid.replaceChildren(...cells);

  // 単位の合計(同じ授業名は1回だけ数える)
  const seen = new Map();
  for (const c of Object.values(tt.classes)) {
    if (c && c.credits && !seen.has(c.name)) seen.set(c.name, Number(c.credits) || 0);
  }
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  $('#tt-credits').textContent = seen.size ? `登録している単位の合計: ${total}単位` : '';
}

let editingSlot = null;

function openClass(day, period) {
  const tt = state.timetable;
  const p = tt.periods[period - 1];
  const c = tt.classes[classKey(day, period)];
  editingSlot = { day, period };
  const f = $('#form-class');
  f.reset();
  $('#class-slot').textContent = `${WD[day]}曜 ${period}限(${p.start}〜${p.end})`;
  if (c) {
    f.name.value = c.name || '';
    f.room.value = c.room || '';
    f.teacher.value = c.teacher || '';
    f.credits.value = c.credits ?? '';
    f.course.value = c.course || '';
  }
  // manabaから取り込んだコース名を候補に出す
  const courses = [...new Set(state.tasks.map((t) => t.course).filter(Boolean))].sort();
  $('#course-list').replaceChildren(...courses.map((x) => el('option', { value: x })));

  const tasks = tasksForClass(c);
  const now = Date.now();
  $('#class-tasks').replaceChildren(...(tasks.length ? [
    el('div', { class: 'small muted' }, 'この授業の未完了の課題'),
    ...tasks.map((t) => el('div', { class: `class-task ${urgency(t.end, now)}` },
      t.url ? el('a', { href: t.url, target: '_blank', rel: 'noopener' }, t.title) : el('span', {}, t.title),
      el('span', { class: 'small' }, ` ${fmtDue(t.end)} ${fmtRemain(t.end, now)}`))),
  ] : []));
  const links = c && Array.isArray(c.courses) ? c.courses.filter((x) => x.url) : [];
  if (links.length) {
    $('#class-tasks').prepend(el('div', { class: 'small' }, 'manabaのコース: ',
      ...links.flatMap((x, i) => [i ? ' / ' : null, el('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.name)])));
  }
  // manabaから取り込んだコマはコース名が決まっているので入力欄を隠す
  $('#form-class').course.closest('label').hidden = Boolean(c && c.courses && c.courses.length);
  $('#btn-class-clear').hidden = !c;
  $('#dlg-class').showModal();
}

$('#form-class').addEventListener('submit', (ev) => {
  if (!editingSlot || (ev.submitter && ev.submitter.value !== 'ok')) return;
  const f = ev.target;
  const name = f.name.value.trim();
  if (!name) return;
  const credits = f.credits.value === '' ? null : Number(f.credits.value);
  const key = classKey(editingSlot.day, editingSlot.period);
  const old = state.timetable.classes[key] || {};
  state.timetable.classes[key] = {
    ...old,
    nameEdited: old.name ? old.name !== name || old.nameEdited || false : false,
    name,
    room: f.room.value.trim(),
    teacher: f.teacher.value.trim(),
    credits: Number.isFinite(credits) ? credits : null,
    course: f.course.value.trim(),
  };
  saveState();
  renderTimetable();
  toast('保存しました');
});

$('#btn-class-clear').addEventListener('click', () => {
  if (!editingSlot) return;
  const key = classKey(editingSlot.day, editingSlot.period);
  const c = state.timetable.classes[key];
  if (c && !confirm(`「${c.name}」をこのコマから消しますか?`)) return;
  delete state.timetable.classes[key];
  saveState();
  renderTimetable();
  $('#dlg-class').close();
});

/* ---------- manaba を Safari で開く ---------- */
// ブックマークレット「manaba取込」は Safari に登録してあるので、標準ブラウザが Brave などでも
// Safari 本体で開くよう iOS の x-safari-https: を使う。
const MANABA_TODO_URL = 'https://bunkyo-u.manaba.jp/ct/home_library_query';
const MANABA_COURSE_URL = 'https://bunkyo-u.manaba.jp/ct/home_course?chglistformat=timetable';
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function manabaUrl(url) { return isIOS ? 'x-safari-' + url : url; }

/* ---------- 画面の切り替え ---------- */

const TAB_KEY = 'manabaPwa.tab';
let currentView = 'tasks';
try { currentView = localStorage.getItem(TAB_KEY) || 'tasks'; } catch { /* ignore */ }

function showView(view) {
  currentView = view === 'timetable' ? 'timetable' : 'tasks';
  try { localStorage.setItem(TAB_KEY, currentView); } catch { /* ignore */ }
  $('#view-tasks').hidden = currentView !== 'tasks';
  $('#view-timetable').hidden = currentView !== 'timetable';
  // 時間割画面では ① で manaba のコース一覧(曜日表示)を開く
  $('#btn-open-manaba').href = manabaUrl(currentView === 'timetable' ? MANABA_COURSE_URL : MANABA_TODO_URL);
  $('#page-title').textContent = currentView === 'tasks' ? '未提出課題' : '時間割';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
  renderAll();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function renderAll() {
  render();
  renderTimetable();
  const urgent = state.tasks.filter((t) => !t.done && urgency(t.end, Date.now()) === 'urgent').length;
  const badge = $('#tab-badge');
  badge.hidden = !urgent;
  badge.textContent = urgent;
}

/* ---------- 起動 ---------- */

// 1タップ取り込み: クリップボードを読んで、manabaのデータならそのまま取り込む。
// 読めない・manabaのデータでないときは、従来の取り込み画面を開く。
async function quickImport() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    openImport();
    return;
  }
  let parsed;
  try {
    parsed = parseImport(text);
  } catch {
    openImport(text);
    return;
  }
  if (parsed.kind === 'timetable') {
    if (!confirm(`manabaの時間割(${parsed.slots.length}コマ)を取り込みますか?\n今の時間割は置き換わります(同じ授業の教室・単位数などは残ります)。`)) return;
    const n = applyTimetable(parsed.slots);
    toast(`時間割を取り込みました(${n}コマ)`);
    showView('timetable');
    return;
  }
  const p = planMerge(parsed.items);
  applyMerge(parsed.items);
  const parts = [`新規${p.added}件`, `更新${p.updated}件`];
  if (p.missing) parts.push(`一覧から消えた${p.missing}件`);
  toast(`取り込みました(${parts.join('・')})`);
}

$('#btn-import').addEventListener('click', quickImport);


$('#btn-add').addEventListener('click', openAdd);

showView(currentView);
checkHashImport();
window.addEventListener('hashchange', checkHashImport);
setInterval(renderAll, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// テスト用に公開
window.__app = { parseManabaDate, parseImport, nowInfo };
