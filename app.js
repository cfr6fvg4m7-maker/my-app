'use strict';

/* ============================================================
 * manaba 未提出課題 PWA
 * データはすべて端末内 (localStorage) に保存する。
 * ============================================================ */

const STORAGE_KEY = 'manabaPwa';
const SCHEMA_VERSION = 3;
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
    // 学期ごとの時間割。キーは "2026-spring" / "2026-fall"
    // classes のキーは "曜日-時限" (例: "1-2" = 月曜2限)
    terms: {},
    // 出席のルール(授業ごとに sessions / lateCount で上書きできる)
    rules: { sessions: 15, failRatio: 1 / 3, lateCount: 1 },
    currentTerm: null, // 表示中の学期
    autoTerm: null,    // 最後に自動で合わせた学期(学期が変わったら自動で切り替えるため)
  };
}

/* ---------- 学期 ---------- */
// 年度は4月始まり。4〜8月を春学期、9〜翌3月を秋学期とする。
function termIdFor(date = new Date()) {
  const m = date.getMonth() + 1;
  const year = m >= 4 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${m >= 4 && m <= 8 ? 'spring' : 'fall'}`;
}

function termLabel(id) {
  const [y, season] = id.split('-');
  return `${y}年度 ${season === 'spring' ? '春学期' : '秋学期'}`;
}

// 学期を順番に並べるための数値(新しいほど大きい)
function termOrder(id) {
  const [y, season] = id.split('-');
  return Number(y) * 2 + (season === 'fall' ? 1 : 0);
}

function termFromOrder(n) {
  return `${Math.floor(n / 2)}-${n % 2 ? 'fall' : 'spring'}`;
}

function ensureTerm(tt, id) {
  if (!tt.terms[id]) tt.terms[id] = { classes: {} };
  // 出席の記録: attendance["曜日-時限"] = [{ date: "2026-11-26", status: "present" | "late" | "absent" }]
  if (!tt.terms[id].attendance) tt.terms[id].attendance = {};
  return tt.terms[id];
}

// 起動時: 今日の学期を用意し、学期が変わっていたら自動で切り替える
function syncTerm(s, date = new Date()) {
  const tt = s.timetable;
  const id = termIdFor(date);
  ensureTerm(tt, id);
  if (tt.autoTerm !== id || !tt.currentTerm || !tt.terms[tt.currentTerm]) {
    tt.currentTerm = id;
    tt.autoTerm = id;
  }
}

// 表示中の学期の時間割
function ttClasses() {
  const tt = state.timetable;
  return ensureTerm(tt, tt.currentTerm || termIdFor()).classes;
}

function emptyState() {
  // 将来ここに attendance などを追加していく
  const s = { version: SCHEMA_VERSION, tasks: [], lastImportAt: null, timetable: defaultTimetable() };
  syncTerm(s);
  return s;
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
  // v2 → v3: 時間割を学期ごとに分ける(今までの時間割は今の学期に入れる)
  if (!s.timetable.terms) {
    s.timetable.terms = {};
    if (s.timetable.classes) s.timetable.terms[termIdFor()] = { classes: s.timetable.classes };
  }
  delete s.timetable.classes;
  if (!s.timetable.rules) s.timetable.rules = { sessions: 15, failRatio: 1 / 3, lateCount: 1 };
  // バージョンが上がったらここで変換処理を追加する
  s.version = SCHEMA_VERSION;
  syncTerm(s);
  return s;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();
try { saveState(); } catch { /* 保存できない環境でも表示は続ける */ } // 変換後の形で保存しておく

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
      box.replaceChildren(el('div', {}, `時間割: ${parsed.slots.length}コマを「${termLabel(state.timetable.currentTerm)}」に取り込みます`),
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
  const classes = ttClasses();
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
  const todays = (tt.terms[termIdFor(date)] || { classes: {} }).classes;
  const day = date.getDay();
  const min = date.getHours() * 60 + date.getMinutes();
  let current = null;
  let last = null;
  const upcoming = [];
  const dayInfo = calDayInfo(date);
  const noClass = dayInfo && dayInfo.type !== 'class';
  if (tt.days.includes(day) && !noClass) {
    tt.periods.forEach((p, i) => {
      const c = todays[classKey(day, i + 1)];
      if (min >= toMin(p.start) && min < toMin(p.end)) current = { period: i + 1, p, c };
      else if (min < toMin(p.start) && c) upcoming.push({ period: i + 1, p, c });
      else if (min >= toMin(p.end) && c) last = { period: i + 1, p, c };
    });
  }
  return { day, current, last, next: upcoming[0] || null, dayInfo };
}

function renderTermSelect() {
  const tt = state.timetable;
  const ids = new Set(Object.keys(tt.terms));
  const cur = termOrder(termIdFor());
  // 前の学期と次の学期は、まだなくても選べるようにする
  ids.add(termFromOrder(cur - 1));
  ids.add(termFromOrder(cur + 1));
  ids.add(tt.currentTerm);
  const sorted = [...ids].sort((a, b) => termOrder(b) - termOrder(a));
  const sel = $('#term-select');
  sel.replaceChildren(...sorted.map((id) => {
    const n = tt.terms[id] ? Object.keys(tt.terms[id].classes).length : 0;
    const note = termOrder(id) === cur ? '(今の学期)' : n ? '' : '(空)';
    return el('option', { value: id, selected: id === tt.currentTerm }, termLabel(id) + note);
  }));
}

$('#term-select').addEventListener('change', (ev) => {
  const tt = state.timetable;
  tt.currentTerm = ev.target.value;
  ensureTerm(tt, tt.currentTerm);
  saveState();
  renderTimetable();
});

function renderTimetable() {
  const tt = state.timetable;
  const classes = ttClasses();
  const now = new Date();
  const viewingNow = tt.currentTerm === termIdFor(now);
  const info = nowInfo(now);
  // 今の学期を表示しているときだけ、今日・今の時限を強調する
  const day = viewingNow ? info.day : -1;
  const current = viewingNow ? info.current : null;
  const next = info.next;
  renderTermSelect();

  // 上部: 今日の状況 / 今の授業 / 次の授業
  const lines = [];
  const todayDs = dateStr(now);
  const todayTerm = termIdFor(now);
  const no = (period) => {
    const n = sessionNo(todayTerm, info.day, todayDs);
    return n ? ` 第${n}回` : '';
  };
  if (info.dayInfo && info.dayInfo.label) {
    lines.push(el('div', { class: `day-info ${info.dayInfo.type}` },
      info.dayInfo.type === 'class' ? `今日は${info.dayInfo.label}` : `今日は授業がありません(${info.dayInfo.label})`));
  }
  if (info.current && info.current.c) {
    const current = info.current;
    lines.push(el('div', {}, el('b', {}, `今 ${current.period}限 `), current.c.name + no(current.period),
      current.c.room ? el('span', { class: 'muted' }, `(${current.c.room})`) : null,
      el('span', { class: 'muted' }, ` 〜${current.p.end}`)));
  }
  if (next) {
    lines.push(el('div', {}, el('b', {}, `次 ${next.period}限 `), next.c.name + no(next.period),
      next.c.room ? el('span', { class: 'muted' }, `(${next.c.room})`) : null,
      el('span', { class: 'muted' }, ` ${next.p.start}〜`)));
  }
  // 今の授業(なければ今日さっき終わった授業)の出席をここで記録できる
  const attTarget = info.current && info.current.c ? info.current : info.last;
  if (attTarget) {
    const todayTerm = termIdFor(now);
    const key = classKey(info.day, attTarget.period);
    const sum = attSummary(todayTerm, key, attTarget.c);
    lines.push(el('div', { class: 'now-att' },
      el('span', { class: 'small' }, attTarget === info.current ? '出席を記録:' : `${attTarget.period}限 ${attTarget.c.name} の出席:`),
      attButtons(todayTerm, key, dateStr(now), () => renderTimetable()),
      el('span', { class: `small att-mini ${sum.level}` }, attText(sum))));
  }
  if (!(info.current && info.current.c) && !next && !(info.dayInfo && info.dayInfo.type !== 'class')) {
    const todays = (tt.terms[termIdFor(now)] || { classes: {} }).classes;
    const any = tt.days.includes(info.day) && tt.periods.some((_, i) => todays[classKey(info.day, i + 1)]);
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
      const c = classes[classKey(d, period)];
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
        (() => {
          if (!c) return null;
          const a = attSummary(tt.currentTerm, classKey(d, period), c);
          return a.equiv ? el('span', { class: `tt-att ${a.level}` }, `欠${a.equiv}/${a.allowed}`) : null;
        })(),
        n ? el('span', { class: 'tt-badge' }, `課題${n}`) : null,
      ));
    }
  });
  const grid = $('#tt-grid');
  grid.style.gridTemplateColumns = `34px repeat(${tt.days.length}, minmax(0, 1fr))`;
  grid.replaceChildren(...cells);

  // 単位の合計(同じ授業名は1回だけ数える)
  const sumCredits = (list) => {
    const seen = new Map();
    for (const c of list) if (c && c.credits && !seen.has(c.name)) seen.set(c.name, Number(c.credits) || 0);
    return [...seen.values()].reduce((a, b) => a + b, 0);
  };
  const termTotal = sumCredits(Object.values(classes));
  // 全学期: 学期が違えば同じ授業名でも別に数える
  const allTotal = Object.values(tt.terms).reduce((a, t) => a + sumCredits(Object.values(t.classes)), 0);
  renderAttSummary();
  $('#tt-credits').textContent = allTotal
    ? `この学期の単位: ${termTotal}単位 ・ 全学期の合計: ${allTotal}単位`
    : '';
}

let editingSlot = null;

function openClass(day, period) {
  const tt = state.timetable;
  const p = tt.periods[period - 1];
  const c = ttClasses()[classKey(day, period)];
  editingSlot = { day, period };
  const f = $('#form-class');
  f.reset();
  $('#class-slot').textContent = `${WD[day]}曜 ${period}限(${p.start}〜${p.end})`;
  if ($('#att-date')) $('#att-date').value = '';
  renderClassAtt();
  if (c) {
    f.sessions.value = c.sessions || '';
    f.lateCount.value = c.lateCount || '';
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
  const old = ttClasses()[key] || {};
  ttClasses()[key] = {
    ...old,
    nameEdited: old.name ? old.name !== name || old.nameEdited || false : false,
    name,
    room: f.room.value.trim(),
    teacher: f.teacher.value.trim(),
    credits: Number.isFinite(credits) ? credits : null,
    course: f.course.value.trim(),
    sessions: Number(f.sessions.value) > 0 ? Math.floor(Number(f.sessions.value)) : null,
    lateCount: Number(f.lateCount.value) > 0 ? Math.floor(Number(f.lateCount.value)) : null,
  };
  saveState();
  renderTimetable();
  toast('保存しました');
});

$('#btn-class-clear').addEventListener('click', () => {
  if (!editingSlot) return;
  const key = classKey(editingSlot.day, editingSlot.period);
  const c = ttClasses()[key];
  if (c && !confirm(`「${c.name}」をこのコマから消しますか?`)) return;
  delete ttClasses()[key];
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

/* ---------- 出席 ---------- */

const ATT_LABEL = { present: '出席', late: '遅刻', absent: '欠席' };

function dateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// その曜日の直近の日付(今日がその曜日なら今日)
function recentDateFor(day, now = new Date(), termId = state.timetable.currentTerm) {
  // 年間予定があれば、今日までで一番近い授業日
  const dates = calClassDates(termId, day);
  const today = dateStr(now);
  if (dates && dates.length) {
    const past = dates.filter((x) => x <= today);
    return past.length ? past[past.length - 1] : dates[0];
  }
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() - day + 7) % 7));
  return dateStr(d);
}

// 年間予定にもとづく「第何回」(なければ null)
function sessionNo(termId, day, ds) {
  const dates = calClassDates(termId, day);
  if (!dates) return null;
  const i = dates.indexOf(ds);
  return i >= 0 ? i + 1 : null;
}

function attList(termId, key) {
  const term = ensureTerm(state.timetable, termId);
  return term.attendance[key] || [];
}

function setAttendance(termId, key, date, status) {
  const term = ensureTerm(state.timetable, termId);
  const list = (term.attendance[key] || []).filter((r) => r.date !== date);
  if (status) list.push({ date, status });
  list.sort((a, b) => a.date.localeCompare(b.date));
  if (list.length) term.attendance[key] = list; else delete term.attendance[key];
  saveState();
}

// 欠席の数え方: 欠席 + 遅刻(lateCount回で1回)。授業回数の failRatio 以上で単位NG
function attSummary(termId, key, c) {
  const rules = state.timetable.rules;
  const list = attList(termId, key);
  const n = { present: 0, late: 0, absent: 0 };
  for (const r of list) if (n[r.status] != null) n[r.status]++;
  const calDates = calClassDates(termId, Number(key.split('-')[0]));
  const sessions = (c && c.sessions) || (calDates && calDates.length) || rules.sessions;
  const lateCount = (c && c.lateCount) || rules.lateCount;
  const equiv = n.absent + Math.floor(n.late / lateCount);
  const failAt = Math.ceil(sessions * rules.failRatio - 1e-9); // 15回なら5回で不可
  const allowed = failAt - 1;
  const remain = allowed - equiv;
  const level = remain < 0 ? 'over' : remain <= 1 ? 'danger' : remain <= 2 ? 'warn' : '';
  return { ...n, total: list.length, equiv, allowed, remain, level, sessions, lateCount };
}

function attText(sum) {
  if (sum.remain < 0) return `欠席 ${sum.equiv}回(上限${sum.allowed}回をこえています)`;
  if (sum.remain === 0) return `欠席 ${sum.equiv}/${sum.allowed}回 ・ これ以上休めません`;
  return `欠席 ${sum.equiv}/${sum.allowed}回 ・ あと${sum.remain}回休めます`;
}

function attButtons(termId, key, date, onDone, keepOne = false) {
  const cur = attList(termId, key).find((r) => r.date === date);
  return el('div', { class: 'att-buttons' },
    ...['present', 'late', 'absent'].map((st) => el('button', {
      type: 'button',
      class: `att-btn ${st} ${cur && cur.status === st ? 'on' : ''}`,
      onclick: () => {
        // 同じボタンをもう一度押すと取り消し(一覧の編集では取り消さず、削除は🗑で)
        if (keepOne && cur && cur.status === st) return;
        setAttendance(termId, key, date, cur && cur.status === st ? null : st);
        onDone();
      },
    }, ATT_LABEL[st])));
}

function renderClassAtt() {
  const box = $('#class-att');
  const { day, period } = editingSlot;
  const key = classKey(day, period);
  const termId = state.timetable.currentTerm;
  const c = ttClasses()[key];
  if (!c) { box.replaceChildren(); return; }
  const dateInput = $('#att-date') || el('input', { type: 'date', id: 'att-date', class: 'att-date' });
  if (!dateInput.value) dateInput.value = recentDateFor(day);
  dateInput.onchange = renderClassAtt;
  const sum = attSummary(termId, key, c);
  const list = attList(termId, key).slice().reverse();
  box.replaceChildren(
    el('div', { class: `att-head ${sum.level}` }, el('b', {}, '出席'), ' ', attText(sum)),
    el('div', { class: 'small muted' }, `出席${sum.present} ・ 遅刻${sum.late} ・ 欠席${sum.absent}(全${sum.sessions}回 / 遅刻${sum.lateCount}回で欠席1回)`),
    el('div', { class: 'att-row' }, dateInput, attButtons(termId, key, dateInput.value, () => { renderClassAtt(); renderTimetable(); })),
    el('button', {
      type: 'button', class: 'btn wide small-btn',
      onclick: () => openAttLog(key),
    }, `出席の記録を見る・編集(${list.length}件)`),
  );
}

/* ---------- 出席の記録(授業ごとの一覧・編集) ---------- */

let attLogKey = null;
let attFilter = 'all';

function fmtDay(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
}

function openAttLog(key) {
  attLogKey = key;
  attFilter = 'all';
  const [day] = key.split('-').map(Number);
  $('#att-add-date').value = recentDateFor(day);
  renderAttLog();
  if (!$('#dlg-att').open) $('#dlg-att').showModal();
}

function renderAttLog() {
  const key = attLogKey;
  const termId = state.timetable.currentTerm;
  const c = ttClasses()[key];
  const [day, period] = key.split('-').map(Number);
  $('#att-title').textContent = `${c ? c.name : ''}(${WD[day]}${period})`;
  const sum = attSummary(termId, key, c);
  $('#att-stat').className = `att-head ${sum.level}`;
  $('#att-stat').replaceChildren(el('b', {}, attText(sum)),
    el('div', { class: 'small muted' }, `出席${sum.present} ・ 遅刻${sum.late} ・ 欠席${sum.absent}(全${sum.sessions}回 / 遅刻${sum.lateCount}回で欠席1回)`));

  // 年間予定があれば、今日までの授業日を全部並べる(記録していない日は「未記録」)
  const today = dateStr(new Date());
  const calDates = (calClassDates(termId, day) || []).filter((x) => x <= today);
  const recs = new Map(attList(termId, key).map((r) => [r.date, r]));
  const rows = [...new Set([...calDates, ...recs.keys()])].sort().reverse()
    .map((ds) => ({ date: ds, status: recs.has(ds) ? recs.get(ds).status : 'none', no: sessionNo(termId, day, ds) }));
  const counts = { all: rows.length, absent: sum.absent, late: sum.late, present: sum.present, none: rows.filter((r) => r.status === 'none').length };
  $('#att-filter').replaceChildren(...[['all', 'すべて'], ['absent', '欠席'], ['late', '遅刻'], ['present', '出席'], ['none', '未記録']]
    .filter(([k]) => k !== 'none' || calDates.length)
    .map(([k, label]) => el('button', {
      type: 'button', class: `att-tab ${attFilter === k ? 'on' : ''}`,
      onclick: () => { attFilter = k; renderAttLog(); },
    }, `${label} ${counts[k]}`)));

  const refresh = () => { renderAttLog(); renderTimetable(); if (editingSlot) renderClassAtt(); };
  const list = rows.filter((r) => attFilter === 'all' || r.status === attFilter);
  $('#att-list').replaceChildren(...(list.length ? list.map((r) => el('li', { class: `att-item ${r.status}` },
    el('span', { class: 'att-day' }, fmtDay(r.date), r.no ? el('small', {}, `第${r.no}回`) : null),
    attButtons(termId, key, r.date, refresh, true),
    r.status === 'none' ? el('span', { class: 'att-none small' }, '未記録') : el('button', {
      type: 'button', class: 'att-trash', 'aria-label': `${fmtDay(r.date)}の記録を削除`,
      onclick: () => {
        if (!confirm(`${fmtDay(r.date)} の記録(${ATT_LABEL[r.status]})を削除しますか?`)) return;
        setAttendance(termId, key, r.date, null);
        refresh();
      },
    }, '🗑'),
  )) : [el('li', { class: 'muted small att-empty' }, attFilter === 'all' ? 'まだ記録がありません' : 'この種類の日はありません')]));

  const addDate = $('#att-add-date');
  addDate.onchange = renderAttLog;
  $('#att-add-buttons').replaceChildren(attButtons(termId, key, addDate.value, refresh));
}

// 時間割画面の下: 授業ごとの出席のまとめ
function renderAttSummary() {
  const tt = state.timetable;
  const termId = tt.currentTerm;
  const classes = ttClasses();
  const keys = Object.keys(classes).sort((a, b) => {
    const [d1, p1] = a.split('-').map(Number);
    const [d2, p2] = b.split('-').map(Number);
    return d1 - d2 || p1 - p2;
  });
  const box = $('#att-summary');
  if (!keys.length) { box.replaceChildren(); return; }
  box.replaceChildren(
    el('h3', {}, '出席のまとめ'),
    el('div', { class: 'att-sum-list' }, ...keys.map((key) => {
      const c = classes[key];
      const [day, period] = key.split('-').map(Number);
      const sum = attSummary(termId, key, c);
      return el('button', { type: 'button', class: `att-sum-row ${sum.level}`, onclick: () => openAttLog(key) },
        el('span', { class: 'att-sum-slot' }, `${WD[day]}${period}`),
        el('span', { class: 'att-sum-name' }, c.name),
        el('span', { class: 'att-sum-count' }, sum.total ? `欠${sum.equiv}/${sum.allowed}` : '記録なし'),
        el('span', { class: 'att-sum-arrow' }, '›'));
    })),
  );
}

/* ---------- バックアップ ---------- */

async function exportBackup() {
  const d = new Date();
  const name = `manaba-backup-${dateStr(d)}.json`;
  const body = JSON.stringify({ app: 'manaba-pwa-backup', v: 1, exportedAt: d.toISOString(), data: state }, null, 1);
  const file = new File([body], name, { type: 'application/json' });
  let done = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'manaba課題 バックアップ' });
      done = true;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  if (!done) {
    const url = URL.createObjectURL(file);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  state.lastBackupAt = Date.now();
  saveState();
  renderBackupInfo();
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('バックアップのファイルとして読み取れませんでした');
    return;
  }
  if (!data || data.app !== 'manaba-pwa-backup' || !data.data) {
    toast('このアプリのバックアップではないようです');
    return;
  }
  const when = data.exportedAt ? fmtDue(new Date(data.exportedAt).getTime()) : '不明';
  if (!confirm(`${when} のバックアップで、今のデータを置き換えます。よろしいですか?`)) return;
  state = migrate(data.data);
  saveState();
  renderAll();
  $('#dlg-backup').close();
  toast('バックアップから元に戻しました');
}

function renderBackupInfo() {
  $('#backup-info').textContent = state.lastBackupAt
    ? `最後に書き出した日: ${fmtDue(state.lastBackupAt)}`
    : 'まだ書き出したことはありません。';
}

$('#btn-backup').addEventListener('click', () => { renderBackupInfo(); $('#dlg-backup').showModal(); });
$('#btn-export').addEventListener('click', exportBackup);
$('#file-import').addEventListener('change', (ev) => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (f) importBackup(f);
});

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
  syncTerm(state); // 開いたまま学期をまたいだときも切り替える
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
    if (!confirm(`manabaの時間割(${parsed.slots.length}コマ)を「${termLabel(state.timetable.currentTerm)}」に取り込みますか?\n今の時間割は置き換わります(同じ授業の教室・単位数などは残ります)。`)) return;
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
