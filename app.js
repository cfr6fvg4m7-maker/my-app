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
  const s = { version: SCHEMA_VERSION, tasks: [], exams: [], lastImportAt: null, timetable: defaultTimetable() };
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
  if (!Array.isArray(s.exams)) s.exams = []; // 試験の予定 [{ id, course, kind, date, period, memo }]
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

// replaceChildren の null / false を無視する版(条件付きの要素をそのまま渡せる)
function setKids(node, ...kids) {
  node.replaceChildren(...kids.filter((k) => k != null && k !== false));
}

// 時刻なしの「やること」は日付だけ表示
function fmtTaskDue(t) {
  return t.allDay ? fmtDue(t.end).replace(/ \d\d:\d\d$/, '') : fmtDue(t.end);
}

function renderTask(t, now) {
  const u = t.done ? '' : urgency(t.end, now);
  const titleNode = t.url
    ? el('a', { class: 'title', href: t.url, target: '_blank', rel: 'noopener' }, t.title)
    : el('span', { class: 'title' }, t.title);

  const badges = [];
  if (t.type) badges.push(el('span', { class: 'badge' }, t.type));
  if (t.source === 'manual') badges.push(el('span', { class: 'badge' }, '手動'));
  if (t.source === 'todo') badges.push(el('span', { class: 'badge todo' }, 'やること'));
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
      t.memo ? el('div', { class: 'memo' }, `📝 ${t.memo}`) : null,
      el('div', { class: 'due' },
        t.source === 'todo' ? 'いつまで ' : '締切 ', fmtTaskDue(t),
        t.done ? null : el('span', { class: 'remain' }, fmtRemain(t.end, now)),
      ),
    ),
    el('div', { class: 'task-actions' },
      el('button', { class: 'edit', 'aria-label': '編集', onclick: () => openTodo('', t.id) }, '✎'),
      t.done ? null : el('button', { class: 'ai-btn', 'aria-label': 'AIに相談', onclick: () => openAi(t.id) }, '💡'),
      el('button', { class: 'del', 'aria-label': '削除', onclick: () => deleteTask(t.id) }, '×')),
  );
}

// やることリストの絞り込み: all / manaba / mine
let taskFilter = 'all';
const isMine = (t) => t.source === 'todo' || t.source === 'manual';

// 締切で「期限切れ/今日/明日/今週/来週以降」に分ける
function taskGroup(t, now) {
  const today = parseYmd(dateStr(new Date(now)));
  const d = new Date(t.end);
  const days = Math.round((parseYmd(dateStr(d)) - today) / DAY);
  if (t.end < now && !(t.allDay && days === 0)) return 'overdue';
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return 'week';
  return 'later';
}
const GROUPS = [
  ['overdue', '期限切れ'], ['today', '今日'], ['tomorrow', '明日'], ['week', '1週間以内'], ['later', 'それより先'],
];

function render() {
  const now = Date.now();
  const all = state.tasks.filter((t) => !t.done);
  const pick = (t) => taskFilter === 'all' || (taskFilter === 'mine' ? isMine(t) : !isMine(t));
  const open = all.filter(pick).sort((a, b) => a.end - b.end);
  const done = state.tasks.filter((t) => t.done && pick(t)).sort((a, b) => b.end - a.end);

  setKids($('#task-filter'), ...[['all', 'すべて', all.length], ['manaba', 'manabaの課題', all.filter((t) => !isMine(t)).length], ['mine', '自分のやること', all.filter(isMine).length]]
    .map(([k, label, n]) => el('button', {
      type: 'button', class: `att-tab ${taskFilter === k ? 'on' : ''}`,
      onclick: () => { taskFilter = k; render(); },
    }, `${label} ${n}`)));

  // リスト / カレンダーの切り替え
  const calMode = taskMode === 'cal';
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === taskMode));
  $('#task-cal').hidden = !calMode;
  $('#list-open').hidden = calMode;
  $('#legend').classList.toggle('in-cal', calMode);
  if (calMode) renderTaskCalendar(open, now);

  setKids($('#list-open'), ...GROUPS.map(([g, label]) => {
    const items = open.filter((t) => taskGroup(t, now) === g);
    if (!items.length) return null;
    return el('section', { class: `task-group ${g}` },
      el('h3', {}, label, el('span', { class: 'count' }, items.length)),
      el('ul', { class: 'task-list' }, ...items.map((t) => renderTask(t, now))));
  }));
  setKids($('#list-done'), ...done.map((t) => renderTask(t, now)));

  $('#empty').hidden = open.length > 0 || calMode;
  $('#legend').hidden = open.length === 0;
  $('#done-section').hidden = done.length === 0;
  $('#done-count').textContent = `(${done.length})`;

  $('#summary').textContent = '';
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
  if (data && data.app === 'manaba-pwa' && data.kind === 'rooms' && Array.isArray(data.days)) {
    const days = data.days
      .filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Array.isArray(x.entries))
      .map((x) => ({ date: x.date, entries: x.entries.filter((e) => e && e.period && e.name && e.room) }));
    return { kind: 'rooms', days };
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
  if (!text.trim()) { setKids(box); return; }
  try {
    const parsed = parseImport(text);
    pendingImport = parsed;
    applyBtn.disabled = false;
    if (parsed.kind === 'rooms') {
      setKids(box, el('div', {}, `Bナビの教室: ${parsed.days.map((d) => WD[parseYmd(d.date).getDay()]).join('・')}曜の分を取り込みます`));
      return;
    }
    if (parsed.kind === 'timetable') {
      setKids(box, el('div', {}, `時間割: ${parsed.slots.length}コマを「${termLabel(state.timetable.currentTerm)}」に取り込みます`),
        el('div', {}, 'manabaから取り込んだ時間割で置き換えます(教室・単位数などの入力は、同じ授業なら残ります)'));
      return;
    }
    const { items, skipped } = parsed;
    const p = planMerge(items);
    applyBtn.disabled = false;
    setKids(box, 
      el('div', {}, `読み取り: ${items.length}件` + (skipped ? `(締切なしなどで除外 ${skipped}件)` : '')),
      el('div', {}, `新規 ${p.added}件 ・ 更新 ${p.updated}件`),
      p.missing ? el('div', {}, `一覧から消えた課題 ${p.missing}件(「一覧にありません」と表示します)`) : null,
    );
  } catch (e) {
    setKids(box, el('div', { class: 'err' }, e.message));
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
  if (parsed.kind === 'rooms') { toast(roomsResultText(applyRooms(parsed.days))); showView('timetable'); return; }
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
    .filter((t) => !t.done && t.course && (t.course === c.name || (names.length ? names.includes(t.course) : t.course.includes(c.name))))
    .sort((a, b) => a.end - b.end);
}

// 授業名をくらべるための形にそろえる(全角/半角、Ⅱ/２/II、空白の違いをなくす)
function normName(s) {
  return String(s || '').normalize('NFKC')
    .replace(/(?<![A-Za-z])(IV|III|II|I)(?![A-Za-z])/g, (r) => ({ I: '1', II: '2', III: '3', IV: '4' })[r])
    .replace(/\s+/g, '')
    .toLowerCase();
}

// その授業(前半・後半のコマは授業ごと)の教室
function unitRoom(c, u) {
  if (!c) return '';
  if (u && c.rooms && c.rooms[u.name]) return c.rooms[u.name];
  return c.room || '';
}

// Bナビの MYスケジュールから読んだ教室を、曜日と時限で時間割に入れる
function applyRooms(days) {
  const result = { updated: 0, unmatched: [], weekdays: [] };
  for (const day of days) {
    const date = parseYmd(day.date);
    const wd = date.getDay();
    const term = state.timetable.terms[termIdFor(date)];
    result.weekdays.push(WD[wd]);
    if (!term) { result.unmatched.push(...day.entries.map((e) => e.name)); continue; }
    for (const e of day.entries) {
      const c = term.classes[classKey(wd, e.period)];
      if (!c) { result.unmatched.push(e.name); continue; }
      const room = e.room.trim();
      if (isSplit(c)) {
        const hit = c.courses.find((x) => normName(x.name) === normName(e.name));
        if (!hit) { result.unmatched.push(e.name); continue; }
        c.rooms = { ...(c.rooms || {}), [hit.name]: room };
      } else {
        c.room = room;
      }
      result.updated++;
    }
  }
  saveState();
  renderAll();
  return result;
}

function roomsResultText(r) {
  let t = `教室を${r.updated}件入れました(${r.weekdays.join('・')}曜)`;
  if (r.unmatched.length) t += `。時間割にない授業: ${r.unmatched.join('、')}`;
  return t;
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
  setKids(sel, ...sorted.map((id) => {
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
  const roomOf = (x) => unitRoom(x.c, unitForDate(slotUnits(todayTerm, classKey(info.day, x.period), x.c), todayDs));
  // 授業名と「第◯回」(前半・後半で分かれるコマは、今日の授業だけ)
  const label = (x) => {
    const units = slotUnits(todayTerm, classKey(info.day, x.period), x.c);
    const u = unitForDate(units, todayDs);
    const name = isSplit(x.c) ? unitLabel(u) : x.c.name;
    const i = u && u.dates ? u.dates.indexOf(todayDs) : -1;
    return i >= 0 ? `${name} 第${i + 1}回` : name;
  };
  if (info.dayInfo && info.dayInfo.label) {
    lines.push(el('div', { class: `day-info ${info.dayInfo.type}` },
      info.dayInfo.type === 'class' ? `今日は${info.dayInfo.label}` : `今日は授業がありません(${info.dayInfo.label})`));
  }
  if (info.current && info.current.c) {
    const current = info.current;
    lines.push(el('div', {}, el('b', {}, `今 ${current.period}限 `), label(current),
      roomOf(current) ? el('span', { class: 'muted' }, `(${roomOf(current)})`) : null,
      el('span', { class: 'muted' }, ` 〜${current.p.end}`)));
  }
  if (next) {
    lines.push(el('div', {}, el('b', {}, `次 ${next.period}限 `), label(next),
      roomOf(next) ? el('span', { class: 'muted' }, `(${roomOf(next)})`) : null,
      el('span', { class: 'muted' }, ` ${next.p.start}〜`)));
  }
  // 今の授業(なければ今日さっき終わった授業)の出席をここで記録できる
  const attTarget = info.current && info.current.c ? info.current : info.last;
  if (attTarget) {
    const todayTerm = termIdFor(now);
    const key = classKey(info.day, attTarget.period);
    const unit = unitForDate(slotUnits(todayTerm, key, attTarget.c), todayDs);
    const sum = attSummary(todayTerm, unit, attTarget.c);
    const who = isSplit(attTarget.c) ? unitLabel(unit) : attTarget.c.name;
    lines.push(el('div', { class: 'now-att' },
      el('span', { class: 'small' }, attTarget === info.current
        ? (isSplit(attTarget.c) ? `${who} の出席:` : '出席を記録:')
        : `${attTarget.period}限 ${who} の出席:`),
      attButtons(todayTerm, unit.akey, todayDs, () => renderTimetable()),
      el('span', { class: `small att-mini ${sum.level}` }, attText(sum))));
  }
  if (!(info.current && info.current.c) && !next && !(info.dayInfo && info.dayInfo.type !== 'class')) {
    const todays = (tt.terms[termIdFor(now)] || { classes: {} }).classes;
    const any = tt.days.includes(info.day) && tt.periods.some((_, i) => todays[classKey(info.day, i + 1)]);
    lines.push(el('div', { class: 'muted' }, any ? '今日の授業はもうありません' : '今日の授業はありません'));
  }
  setKids($('#tt-now'), ...lines);

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
        c && (c.room || c.rooms) ? el('span', { class: 'tt-room' },
          isSplit(c) && c.rooms ? c.courses.map((x) => c.rooms[x.name]).filter(Boolean).join(' / ') : c.room) : null,
        ...(() => {
          if (!c) return [];
          const units = slotUnits(tt.currentTerm, classKey(d, period), c);
          const sums = units.map((u) => attSummary(tt.currentTerm, u, c)).filter((a) => a.equiv);
          return sums.map((a) => el('span', { class: `tt-att ${a.level}` }, `欠${a.equiv}/${a.allowed}`));
        })(),
        n ? el('span', { class: 'tt-badge' }, `課題${n}`) : null,
      ));
    }
  });
  const grid = $('#tt-grid');
  grid.style.gridTemplateColumns = `34px repeat(${tt.days.length}, minmax(0, 1fr))`;
  setKids(grid, ...cells);

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
  renderPending();
  renderExamList();
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
  setKids($('#course-list'), ...courses.map((x) => el('option', { value: x })));

  const tasks = tasksForClass(c);
  const now = Date.now();
  setKids($('#class-tasks'), ...(tasks.length ? [
    el('div', { class: 'small muted' }, 'この授業の未完了の課題・やること'),
    ...tasks.map((t) => el('div', { class: `class-task ${urgency(t.end, now)}` },
      t.url ? el('a', { href: t.url, target: '_blank', rel: 'noopener' }, t.title) : el('span', {}, t.title),
      el('span', { class: 'small' }, ` ${fmtTaskDue(t)} ${fmtRemain(t.end, now)}`))),
  ] : []));
  const links = c && Array.isArray(c.courses) ? c.courses.filter((x) => x.url) : [];
  if (links.length) {
    $('#class-tasks').prepend(el('div', { class: 'small' }, 'manabaのコース: ',
      ...links.flatMap((x, i) => [i ? ' / ' : null, el('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.name)])));
  }
  // manabaから取り込んだコマはコース名が決まっているので入力欄を隠す
  $('#form-class').course.closest('label').hidden = Boolean(c && c.courses && c.courses.length);
  renderClassExtra(c);
  $('#btn-class-clear').hidden = !c;
  if (!$('#dlg-class').open) $('#dlg-class').showModal();
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

// Bナビ(教室などの確認用)。manaba と同じく Safari で開く
const BNAVI_URL = 'https://portal.bunkyo.ac.jp/campusweb/portal.do?page=main';
document.querySelectorAll('.bnavi-link').forEach((a) => { a.href = manabaUrl(BNAVI_URL); });

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

/* 出席を数える単位(unit)
 * 普通のコマ: コマ全体で1つ(akey = "曜日-時限")
 * 前半・後半で授業が分かれるコマ(授業が2つ): 授業ごとに1つ(akey = "曜日-時限|授業名")
 *   前半 = 第1〜8回の授業日、後半 = 第9回以降(足りない回は日付を選んで追加)
 */
const HALF_SESSIONS = 8;

function isSplit(c) {
  return Boolean(c && Array.isArray(c.courses) && c.courses.length >= 2);
}

function slotUnits(termId, slotKey, c) {
  if (!c) return [];
  const [day, period] = slotKey.split('-').map(Number);
  const all = calClassDates(termId, day);
  const rules = state.timetable.rules;
  if (!isSplit(c)) {
    return [{
      akey: slotKey, slotKey, day, period, name: c.name, half: null, dates: all,
      sessions: c.sessions || (all && all.length) || rules.sessions,
    }];
  }
  const order = c.courses.map((x) => x.name);
  if (c.halfSwap) order.reverse();
  return order.map((name, i) => {
    const half = i % 2 === 0 ? 'first' : 'second';
    return {
      akey: `${slotKey}|${name}`, slotKey, day, period, name, half,
      dates: all ? (half === 'first' ? all.slice(0, HALF_SESSIONS) : all.slice(HALF_SESSIONS)) : null,
      sessions: c.sessions || HALF_SESSIONS,
    };
  });
}

// その日に出席を記録する授業(前半・後半のどちらか)
function unitForDate(units, ds) {
  if (units.length <= 1) return units[0] || null;
  const hit = units.find((u) => u.dates && u.dates.includes(ds));
  if (hit) return hit;
  const first = units.find((u) => u.half === 'first');
  const second = units.find((u) => u.half === 'second') || first;
  if (first && first.dates && first.dates.length) return ds <= first.dates[first.dates.length - 1] ? first : second;
  return first;
}

function unitLabel(u) {
  return u.half ? `${u.name}(${u.half === 'first' ? '前半' : '後半'})` : u.name;
}

function recentDateForUnit(u, now = new Date()) {
  const today = dateStr(now);
  if (u.dates && u.dates.length) {
    const past = u.dates.filter((x) => x <= today);
    return past.length ? past[past.length - 1] : u.dates[0];
  }
  return recentDateFor(u.day, now);
}

function findUnit(termId, akey) {
  const slotKey = akey.split('|')[0];
  const c = (state.timetable.terms[termId] || { classes: {} }).classes[slotKey];
  return { c, unit: slotUnits(termId, slotKey, c).find((u) => u.akey === akey) || null };
}

// 欠席の数え方: 欠席 + 遅刻(lateCount回で1回)。授業回数の failRatio 以上で単位NG
function attSummary(termId, unit, c) {
  const rules = state.timetable.rules;
  const list = attList(termId, unit.akey);
  const n = { present: 0, late: 0, absent: 0 };
  for (const r of list) if (n[r.status] != null) n[r.status]++;
  const sessions = unit.sessions;
  const lateCount = (c && c.lateCount) || rules.lateCount;
  const equiv = n.absent + Math.floor(n.late / lateCount);
  const failAt = Math.ceil(sessions * rules.failRatio - 1e-9); // 15回なら5回で不可
  const allowed = failAt - 1;
  const remain = allowed - equiv;
  // まだ1回も休んでいなければ警告しない(8回の授業は最初から残り2回なので)
  const level = remain < 0 ? 'over' : equiv === 0 ? '' : remain <= 1 ? 'danger' : remain <= 2 ? 'warn' : '';
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
  if (!c) { setKids(box); return; }
  const units = slotUnits(termId, key, c);
  const dateInput = $('#att-date') || el('input', { type: 'date', id: 'att-date', class: 'att-date' });
  if (!dateInput.value) dateInput.value = recentDateForUnit(unitForDate(units, dateStr(new Date())));
  dateInput.onchange = renderClassAtt;
  const refresh = () => { renderClassAtt(); renderTimetable(); };
  const blocks = units.map((u) => {
    const sum = attSummary(termId, u, c);
    const n = attList(termId, u.akey).length;
    return el('div', { class: 'att-unit' },
      el('div', { class: `att-head ${sum.level}` }, el('b', {}, isSplit(c) ? unitLabel(u) : '出席'),
        isSplit(c) && unitRoom(c, u) ? el('span', { class: 'small muted' }, ` @${unitRoom(c, u)}`) : null, ' ', attText(sum)),
      el('div', { class: 'small muted' }, `出席${sum.present} ・ 遅刻${sum.late} ・ 欠席${sum.absent}(全${sum.sessions}回 / 遅刻${sum.lateCount}回で欠席1回)`),
      el('div', { class: 'att-row' }, attButtons(termId, u.akey, dateInput.value, refresh),
        el('button', { type: 'button', class: 'btn small-btn', onclick: () => openAttLog(u.akey) }, `記録を見る・編集(${n})`)));
  });
  setKids(box, 
    el('div', { class: 'att-row' }, el('span', { class: 'small' }, '日付'), dateInput),
    ...blocks,
    isSplit(c) ? el('button', {
      type: 'button', class: 'btn small-btn',
      onclick: () => { c.halfSwap = !c.halfSwap; saveState(); refresh(); toast('前半と後半を入れ替えました'); },
    }, '前半と後半を入れ替える') : null,
  );
}

/* ---------- 出席の記録(授業ごとの一覧・編集) ---------- */

let attLogKey = null;
let attFilter = 'all';

function fmtDay(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
}

function openAttLog(akey) {
  attLogKey = akey;
  attFilter = 'all';
  const { unit } = findUnit(state.timetable.currentTerm, akey);
  if (!unit) return;
  $('#att-add-date').value = recentDateForUnit(unit);
  renderAttLog();
  if (!$('#dlg-att').open) $('#dlg-att').showModal();
}

function renderAttLog() {
  const key = attLogKey;
  const termId = state.timetable.currentTerm;
  const { c, unit } = findUnit(termId, key);
  if (!unit) { $('#dlg-att').close(); return; }
  const { day, period } = unit;
  $('#att-title').textContent = `${unitLabel(unit)}(${WD[day]}${period})`;
  const sum = attSummary(termId, unit, c);
  $('#att-stat').className = `att-head ${sum.level}`;
  setKids($('#att-stat'), el('b', {}, attText(sum)),
    el('div', { class: 'small muted' }, `出席${sum.present} ・ 遅刻${sum.late} ・ 欠席${sum.absent}(全${sum.sessions}回 / 遅刻${sum.lateCount}回で欠席1回)`));

  // 年間予定があれば、今日までの授業日を全部並べる(記録していない日は「未記録」)
  const today = dateStr(new Date());
  const calDates = (unit.dates || []).filter((x) => x <= today);
  const recs = new Map(attList(termId, key).map((r) => [r.date, r]));
  const rows = [...new Set([...calDates, ...recs.keys()])].sort().reverse()
    .map((ds) => {
      const i = unit.dates ? unit.dates.indexOf(ds) : -1;
      return { date: ds, status: recs.has(ds) ? recs.get(ds).status : 'none', no: i >= 0 ? i + 1 : null };
    });
  const counts = { all: rows.length, absent: sum.absent, late: sum.late, present: sum.present, none: rows.filter((r) => r.status === 'none').length };
  setKids($('#att-filter'), ...[['all', 'すべて'], ['absent', '欠席'], ['late', '遅刻'], ['present', '出席'], ['none', '未記録']]
    .filter(([k]) => k !== 'none' || calDates.length)
    .map(([k, label]) => el('button', {
      type: 'button', class: `att-tab ${attFilter === k ? 'on' : ''}`,
      onclick: () => { attFilter = k; renderAttLog(); },
    }, `${label} ${counts[k]}`)));

  const refresh = () => { renderAttLog(); renderTimetable(); if (editingSlot) renderClassAtt(); };
  const list = rows.filter((r) => attFilter === 'all' || r.status === attFilter);
  setKids($('#att-list'), ...(list.length ? list.map((r) => el('li', { class: `att-item ${r.status}` },
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
  setKids($('#att-add-buttons'), attButtons(termId, key, addDate.value, refresh));
}

/* ---------- 記録し忘れ ---------- */
// この機能を使い始めた日(attSince)以降で、授業が終わったのに出席を記録していないもの
function pendingAttendance(now = new Date()) {
  const tt = state.timetable;
  const termId = termIdFor(now);
  const term = tt.terms[termId];
  if (!term) return [];
  if (!tt.attSince) { tt.attSince = dateStr(now); saveState(); }
  const today = dateStr(now);
  const min = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (const [slotKey, c] of Object.entries(term.classes)) {
    const period = Number(slotKey.split('-')[1]);
    const p = tt.periods[period - 1];
    if (!p) continue;
    for (const u of slotUnits(termId, slotKey, c)) {
      if (!u.dates) continue; // 年間予定がない学期は対象外
      const recs = new Set(attList(termId, u.akey).map((r) => r.date));
      for (const ds of u.dates) {
        if (ds < tt.attSince || ds > today) continue;
        if (ds === today && min < toMin(p.end)) continue; // 今日はまだ終わっていない
        if (!recs.has(ds)) out.push({ termId, unit: u, c, date: ds, p });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.unit.period - a.unit.period);
}

function renderPending() {
  const list = pendingAttendance();
  const badge = $('#tab-badge-tt');
  badge.hidden = !list.length;
  badge.textContent = list.length;
  if ('setAppBadge' in navigator) {
    try { (list.length ? navigator.setAppBadge(list.length) : navigator.clearAppBadge()).catch(() => {}); } catch { /* 未対応 */ }
  }
  fillPending($('#att-pending'), list);
}

// 記録し忘れの一覧を box に描く(時間割画面と今日画面で共通)
function fillPending(box, list) {
  if (!list.length) { box.hidden = true; setKids(box); return; }
  box.hidden = false;
  const today = dateStr(new Date());
  setKids(box, 
    el('div', { class: 'att-pending-head' }, el('b', {}, `出席をまだ記録していない授業(${list.length})`)),
    ...list.slice(0, 10).map((x) => el('div', { class: 'att-pending-row' },
      el('div', { class: 'att-pending-name' },
        el('span', { class: 'small muted' }, `${x.date === today ? '今日' : fmtDay(x.date)} ${x.unit.period}限 `),
        isSplit(x.c) ? unitLabel(x.unit) : x.unit.name),
      attButtons(x.termId, x.unit.akey, x.date, () => renderAll()))),
    list.length > 10 ? el('div', { class: 'small muted' }, `ほか${list.length - 10}件(「出席のまとめ」から記録できます)`) : null,
  );
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
  if (!keys.length) { setKids(box); return; }
  setKids(box, 
    el('h3', {}, '出席のまとめ'),
    el('div', { class: 'att-sum-list' }, ...keys.flatMap((key) => {
      const c = classes[key];
      return slotUnits(termId, key, c).map((u) => {
        const sum = attSummary(termId, u, c);
        return el('button', { type: 'button', class: `att-sum-row ${sum.level}`, onclick: () => openAttLog(u.akey) },
          el('span', { class: 'att-sum-slot' }, `${WD[u.day]}${u.period}`),
          el('span', { class: 'att-sum-name' }, unitLabel(u)),
          el('span', { class: 'att-sum-count' }, sum.total ? `欠${sum.equiv}/${sum.allowed}` : '記録なし'),
          el('span', { class: 'att-sum-arrow' }, '›'));
      });
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

/* ---------- 今日 ---------- */

function fmtLongDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
}

// 次に授業がある日(年間予定と時間割から。見つからなければ null)
function nextClassDay(now = new Date()) {
  const tt = state.timetable;
  const d = new Date(now);
  for (let i = 1; i <= 60; i++) {
    d.setDate(d.getDate() + 1);
    const info = calDayInfo(d);
    if (info && info.type !== 'class') continue;
    const term = tt.terms[termIdFor(d)];
    if (!term || !tt.days.includes(d.getDay())) continue;
    const periods = tt.periods.map((p, j) => ({ period: j + 1, p, c: term.classes[classKey(d.getDay(), j + 1)] })).filter((x) => x.c);
    if (periods.length) return { date: new Date(d), first: periods[0] };
  }
  return null;
}

function renderToday() {
  const tt = state.timetable;
  const now = new Date();
  const ds = dateStr(now);
  const termId = termIdFor(now);
  const info = nowInfo(now);
  const min = now.getHours() * 60 + now.getMinutes();

  // 見出し: 日付・学期・今日の状況
  const dayLabel = info.dayInfo && info.dayInfo.label
    ? (info.dayInfo.type === 'class' ? info.dayInfo.label : `授業なし(${info.dayInfo.label})`)
    : null;
  setKids($('#today-head'),
    el('div', { class: 'today-date' }, fmtLongDate(now)),
    el('div', { class: 'small muted' }, termLabel(termId), dayLabel ? ` ・ ${dayLabel}` : ''));

  renderCommute(now);
  renderTodayExams(now);

  // 記録し忘れ(今日の授業は下の「今日の授業」で記録するので除く)
  fillPending($('#today-pending'), pendingAttendance(now).filter((x) => x.date !== ds));

  // 今日の授業
  const term = tt.terms[termId];
  const noClass = info.dayInfo && info.dayInfo.type !== 'class';
  const rows = [];
  if (term && !noClass && tt.days.includes(info.day)) {
    tt.periods.forEach((p, i) => {
      const period = i + 1;
      const key = classKey(info.day, period);
      const c = term.classes[key];
      if (!c) return;
      const u = unitForDate(slotUnits(termId, key, c), ds);
      const no = u && u.dates ? u.dates.indexOf(ds) + 1 : 0;
      const state_ = min >= toMin(p.end) ? 'done' : min >= toMin(p.start) ? 'now' : 'later';
      const sum = attSummary(termId, u, c);
      const tasks = tasksForClass(c).length;
      rows.push(el('div', { class: `today-class ${state_}` },
        el('div', { class: 'today-period' }, el('b', {}, `${period}限`), el('span', {}, `${p.start}〜${p.end}`)),
        el('div', { class: 'today-class-body' },
          el('div', { class: 'today-class-name' }, isSplit(c) ? unitLabel(u) : c.name),
          el('div', { class: 'small muted' },
            [unitRoom(c, u), no > 0 ? `第${no}回` : null, state_ === 'now' ? '授業中' : state_ === 'done' ? '終了' : null].filter(Boolean).join(' ・ ')),
          el('div', { class: `small att-mini ${sum.level}` }, attText(sum), tasks ? el('span', { class: 'tt-badge inline' }, `課題${tasks}`) : null),
          state_ !== 'later' ? attButtons(termId, u.akey, ds, () => renderAll()) : null),
        el('button', { type: 'button', class: 'att-sum-arrow link-btn', 'aria-label': '詳細', onclick: () => openClass(info.day, period) }, '›')));
    });
  }
  if (!rows.length) {
    const next = nextClassDay(now);
    rows.push(el('div', { class: 'today-empty muted' },
      noClass ? `今日は授業がありません(${info.dayInfo.label})。` : '今日は授業がありません。',
      next ? el('div', { class: 'small' }, `次の授業: ${fmtLongDate(next.date)} ${next.first.period}限 ${next.first.c.name}`) : null));
  }
  setKids($('#today-classes'), ...rows);

  // 締切が近い課題(48時間以内・期限切れ)
  const t = now.getTime();
  const soon = state.tasks.filter((x) => !x.done && x.end - t <= 2 * DAY).sort((a, b) => a.end - b.end);
  const restCount = state.tasks.filter((x) => !x.done).length - soon.length;
  setKids($('#today-tasks'), ...(soon.length
    ? soon.map((x) => renderTask(x, t))
    : [el('li', { class: 'today-empty muted' }, '48時間以内に締切の課題はありません。',
      restCount ? el('div', { class: 'small' }, `ほかに未完了の課題が${restCount}件あります。`) : null)]));

  // 取り込み忘れ
  const stale = $('#stale');
  const ts = $('#today-stale');
  ts.hidden = stale.hidden;
  ts.textContent = stale.textContent;
}

/* ---------- やること・試験 ---------- */

// 授業の選択肢(今の学期の時間割から。前半・後半のコマは授業ごと)
function classOptions(termId = state.timetable.currentTerm) {
  const term = state.timetable.terms[termId];
  if (!term) return [];
  const keys = Object.keys(term.classes).sort((a, b) => {
    const [d1, p1] = a.split('-').map(Number);
    const [d2, p2] = b.split('-').map(Number);
    return d1 - d2 || p1 - p2;
  });
  const seen = new Set();
  const out = [];
  for (const key of keys) {
    const c = term.classes[key];
    for (const u of slotUnits(termId, key, c)) {
      const value = isSplit(c) || (c.courses && c.courses.length) ? u.name : (c.course || c.name);
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ value, label: `${WD[u.day]}${u.period} ${unitLabel(u)}` });
    }
  }
  return out;
}

function fillCourseSelect(sel, selected, allowEmpty) {
  const opts = classOptions();
  if (selected && !opts.some((o) => o.value === selected)) opts.unshift({ value: selected, label: selected });
  setKids(sel,
    allowEmpty ? el('option', { value: '' }, '(なし)') : null,
    ...opts.map((o) => el('option', { value: o.value, selected: o.value === selected }, o.label)));
}

// --- やること ---
let editingTaskId = null;

// やることの追加・編集。id を渡すと編集(manaba の課題はメモだけ変えられる)
function openTodo(course = '', id = null, date = null) {
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  editingTaskId = t ? t.id : null;
  const fromManaba = Boolean(t && t.source === 'manaba');
  const f = $('#form-todo');
  f.reset();
  fillCourseSelect(f.course, t ? t.course : course, true);
  if (t) {
    const d = new Date(t.end);
    f.title.value = t.title;
    f.date.value = dateStr(d);
    f.time.value = t.allDay ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    f.url.value = t.url || '';
    f.memo.value = t.memo || '';
  } else {
    f.date.value = date || dateStr(new Date(Date.now() + DAY));
  }
  f.querySelectorAll('.todo-edit').forEach((l) => { l.hidden = fromManaba; });
  // manaba の課題は入力欄を隠すので、必須チェックも外す
  f.title.required = !fromManaba;
  f.date.required = !fromManaba;
  $('#todo-note').hidden = !fromManaba;
  $('#todo-note').textContent = fromManaba
    ? `manabaの課題「${t.title}」(締切 ${fmtDue(t.end)})。内容と締切はmanabaから取り込むので、ここではメモだけ書けます。`
    : '';
  $('#todo-title').textContent = !t ? 'やることを追加' : fromManaba ? 'メモを書く' : '編集';
  $('#btn-todo-ok').textContent = t ? '保存' : '追加';
  $('#btn-todo-del').hidden = !t;
  $('#dlg-todo').showModal();
}

$('#form-todo').addEventListener('submit', (ev) => {
  if (ev.submitter && ev.submitter.value !== 'ok') return;
  const f = ev.target;
  const t = editingTaskId && state.tasks.find((x) => x.id === editingTaskId);
  const memo = f.memo.value.trim();
  if (t && t.source === 'manaba') {
    t.memo = memo;
  } else {
    const title = f.title.value.trim();
    if (!title || !f.date.value) return;
    const [y, m, d] = f.date.value.split('-').map(Number);
    const [hh, mm] = f.time.value ? f.time.value.split(':').map(Number) : [23, 59];
    const fields = {
      title, course: f.course.value, url: f.url.value.trim(), memo,
      end: new Date(y, m - 1, d, hh, mm).getTime(), allDay: !f.time.value,
    };
    if (t) Object.assign(t, fields);
    else {
      state.tasks.push({
        id: 'td:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        source: 'todo', type: '', start: null, done: false, doneAt: null, missing: false, addedAt: Date.now(), ...fields,
      });
    }
  }
  saveState();
  renderAll();
  if ($('#dlg-class').open && editingSlot) openClass(editingSlot.day, editingSlot.period);
  toast(t ? '保存しました' : 'やることを追加しました');
});

$('#btn-todo-del').addEventListener('click', () => {
  if (!editingTaskId) return;
  const before = state.tasks.length;
  deleteTask(editingTaskId);
  if (state.tasks.length < before) $('#dlg-todo').close();
});

document.querySelectorAll('[data-add-todo]').forEach((b) => b.addEventListener('click', () => openTodo()));

/* ---------- すぐ追加(やることリストの上の入力欄) ---------- */
let quickWhen = 'tomorrow';

function quickDate(when, now = new Date()) {
  const d = new Date(now);
  if (when === 'tomorrow') d.setDate(d.getDate() + 1);
  if (when === 'weekend') d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); // 次の土曜(今日が土曜なら来週)
  return dateStr(d);
}

function renderQuickWhen() {
  const f = $('#quick-todo');
  f.querySelectorAll('.when-btn[data-when]').forEach((b) => b.classList.toggle('on', b.dataset.when === quickWhen));
  const picked = quickWhen === 'date' && f.date.value;
  f.querySelector('.when-pick').classList.toggle('on', Boolean(picked));
  $('#when-pick-label').textContent = picked ? `📅 ${fmtDay(f.date.value)}` : '📅 日付を選ぶ';
}

$('#quick-todo').querySelectorAll('.when-btn[data-when]').forEach((b) => b.addEventListener('click', () => {
  quickWhen = b.dataset.when;
  $('#quick-todo').date.value = '';
  renderQuickWhen();
}));
$('#quick-todo').date.addEventListener('change', (ev) => {
  quickWhen = ev.target.value ? 'date' : 'tomorrow';
  renderQuickWhen();
});

$('#quick-todo').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const title = f.title.value.trim();
  if (!title) { f.title.focus(); return; }
  const ds = quickWhen === 'date' && f.date.value ? f.date.value : quickDate(quickWhen);
  const [y, m, d] = ds.split('-').map(Number);
  state.tasks.push({
    id: 'td:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    source: 'todo', type: '', title, course: '', url: '',
    start: null, end: new Date(y, m - 1, d, 23, 59).getTime(), allDay: true,
    done: false, doneAt: null, missing: false, addedAt: Date.now(),
  });
  saveState();
  f.title.value = '';
  renderAll();
  toast(`「${title}」を${fmtDay(ds)}に追加しました`);
});


// --- 試験 ---
const EXAM_KINDS = ['定期試験', '小テスト', 'レポート試験', '中間試験', 'その他'];
let editingExamId = null;

function daysUntil(ds, now = new Date()) {
  return Math.round((parseYmd(ds) - parseYmd(dateStr(now))) / DAY);
}

function examWhen(x) {
  const p = x.period ? state.timetable.periods[x.period - 1] : null;
  return `${fmtDay(x.date)}${x.period ? ` ${x.period}限` : ''}${p ? `(${p.start}〜)` : ''}`;
}

function examsForClass(c) {
  if (!c) return [];
  const names = new Set([c.name, c.course, ...classCourseNames(c)].filter(Boolean));
  return state.exams.filter((x) => names.has(x.course)).sort((a, b) => a.date.localeCompare(b.date));
}

function upcomingExams(now = new Date()) {
  const today = dateStr(now);
  return state.exams.filter((x) => x.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.period || 9) - (b.period || 9));
}

function openExam(id = null, course = '') {
  editingExamId = id;
  const x = id ? state.exams.find((e) => e.id === id) : null;
  const f = $('#form-exam');
  f.reset();
  fillCourseSelect(f.course, x ? x.course : course, false);
  const cal = ACADEMIC_CALENDAR[state.timetable.currentTerm];
  const today = dateStr(new Date());
  $('#exam-hint').textContent = cal && cal.exam ? `定期試験期間: ${fmtDay(cal.exam.start)}〜${fmtDay(cal.exam.end)}` : '';
  if (x) {
    f.kind.value = x.kind;
    f.date.value = x.date;
    f.period.value = x.period || '';
    f.memo.value = x.memo || '';
  } else {
    f.date.value = cal && cal.exam && cal.exam.start >= today ? cal.exam.start : today;
  }
  // 定期試験を選んだら、日付を試験期間の初日に合わせる(まだ変えていなければ)
  f.kind.onchange = () => {
    if (!x && f.kind.value === '定期試験' && cal && cal.exam && f.date.value < cal.exam.start) f.date.value = cal.exam.start;
  };
  $('#exam-title').textContent = x ? '試験の予定を編集' : '試験の予定を追加';
  $('#btn-exam-del').hidden = !x;
  $('#dlg-exam').showModal();
}

$('#form-exam').addEventListener('submit', (ev) => {
  if (ev.submitter && ev.submitter.value !== 'ok') return;
  const f = ev.target;
  if (!f.course.value || !f.date.value) return;
  const data = {
    course: f.course.value, kind: f.kind.value, date: f.date.value,
    period: f.period.value ? Number(f.period.value) : null, memo: f.memo.value.trim(),
  };
  const x = editingExamId && state.exams.find((e) => e.id === editingExamId);
  if (x) Object.assign(x, data);
  else state.exams.push({ id: 'ex:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...data });
  saveState();
  renderAll();
  if ($('#dlg-class').open && editingSlot) openClass(editingSlot.day, editingSlot.period);
  toast('試験の予定を保存しました');
});

$('#btn-exam-del').addEventListener('click', () => {
  const x = state.exams.find((e) => e.id === editingExamId);
  if (!x || !confirm(`${x.course} の${x.kind}(${examWhen(x)})を削除しますか?`)) return;
  state.exams = state.exams.filter((e) => e.id !== x.id);
  saveState();
  renderAll();
  $('#dlg-exam').close();
  if ($('#dlg-class').open && editingSlot) openClass(editingSlot.day, editingSlot.period);
});

function examRow(x, now = new Date()) {
  const n = daysUntil(x.date, now);
  const level = n <= 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 7 ? 'soon' : '';
  return el('button', { type: 'button', class: `exam-row ${level}`, onclick: () => openExam(x.id) },
    el('span', { class: 'exam-count' }, n < 0 ? '終了' : n === 0 ? '今日' : n === 1 ? '明日' : `あと${n}日`),
    el('span', { class: 'exam-body' },
      el('b', {}, x.course), el('span', { class: 'small' }, ` ${x.kind}`),
      el('span', { class: 'small muted exam-when' }, examWhen(x) + (x.memo ? ` ・ ${x.memo}` : ''))));
}

// 時間割画面の下: 試験の予定
function renderExamList() {
  const up = upcomingExams();
  setKids($('#exam-list'),
    el('h3', {}, '試験の予定 ', el('button', { type: 'button', class: 'link-btn', onclick: () => openExam() }, '＋ 追加')),
    up.length ? el('div', { class: 'exam-rows' }, ...up.map((x) => examRow(x)))
      : el('p', { class: 'small muted' }, 'まだ登録されていません。コマを押した画面や「＋ 追加」から登録できます。'));
}

// 今日画面: 今日の試験と、30日以内の試験のカウントダウン
function renderTodayExams(now = new Date()) {
  const box = $('#today-exams');
  const up = upcomingExams(now).filter((x) => daysUntil(x.date, now) <= 30);
  if (!up.length) { box.hidden = true; setKids(box); return; }
  box.hidden = false;
  const today = up.filter((x) => daysUntil(x.date, now) === 0);
  const later = up.filter((x) => daysUntil(x.date, now) > 0).slice(0, 4);
  setKids(box,
    today.length ? el('h3', {}, '今日の試験') : null,
    ...today.map((x) => examRow(x, now)),
    later.length ? el('h3', {}, 'もうすぐ試験') : null,
    ...later.map((x) => examRow(x, now)));
}

// コマの画面: この授業のやること・試験
function renderClassExtra(c) {
  const box = $('#class-extra');
  if (!c) { setKids(box); return; }
  const exams = examsForClass(c).filter((x) => x.date >= dateStr(new Date()));
  const course = isSplit(c) ? '' : (c.courses && c.courses.length ? c.courses[0].name : (c.course || c.name));
  setKids(box,
    exams.length ? el('div', { class: 'small muted' }, 'この授業の試験') : null,
    ...exams.map((x) => examRow(x)),
    el('div', { class: 'class-extra-btns' },
      el('button', { type: 'button', class: 'btn small-btn', onclick: () => openTodo(course) }, '＋ やること'),
      el('button', { type: 'button', class: 'btn small-btn', onclick: () => openExam(null, course) }, '＋ 試験の予定')));
}

/* ---------- やること: カレンダー表示 ---------- */
const MODE_KEY = 'manabaPwa.taskMode';
let taskMode = 'list';
try { taskMode = localStorage.getItem(MODE_KEY) || 'list'; } catch { /* ignore */ }
let calMonth = null;   // 表示中の月の1日
let calSelected = null; // 選んだ日 "YYYY-MM-DD"

document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => {
  taskMode = b.dataset.mode;
  try { localStorage.setItem(MODE_KEY, taskMode); } catch { /* ignore */ }
  render();
}));

function renderTaskCalendar(open, now) {
  const today = dateStr(new Date(now));
  if (!calMonth) { const d = new Date(now); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  if (!calSelected) calSelected = today;
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();

  // 日付ごとに課題・やること・試験をまとめる
  const byDay = new Map();
  const add = (ds, kind, x) => {
    if (!byDay.has(ds)) byDay.set(ds, { tasks: [], exams: [] });
    byDay.get(ds)[kind].push(x);
  };
  for (const t of open) add(dateStr(new Date(t.end)), 'tasks', t);
  for (const x of state.exams) add(x.date, 'exams', x);

  const cells = WD.map((w, i) => el('div', { class: `cal-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}` }, w));
  const first = new Date(y, m, 1);
  for (let i = 0; i < first.getDay(); i++) cells.push(el('div', { class: 'cal-day empty' }));
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d);
    const ds = dateStr(date);
    const info = byDay.get(ds) || { tasks: [], exams: [] };
    const dayInfo = calDayInfo(date);
    const off = dayInfo && dayInfo.type === 'off' && date.getDay() !== 0;
    const examPeriod = dayInfo && dayInfo.type === 'exam';
    // その日の中で一番急ぎの色
    const levels = info.tasks.map((t) => urgency(t.end, now));
    const level = levels.includes('overdue') || levels.includes('urgent') ? 'urgent' : levels.includes('soon') ? 'soon' : '';
    cells.push(el('button', {
      type: 'button',
      class: ['cal-day', ds === today ? 'today' : '', ds === calSelected ? 'sel' : '', off ? 'off' : '', examPeriod ? 'exam-period' : '',
        date.getDay() === 0 ? 'sun' : date.getDay() === 6 ? 'sat' : ''].filter(Boolean).join(' '),
      'aria-label': `${m + 1}月${d}日 ${info.tasks.length}件${info.exams.length ? ' 試験あり' : ''}`,
      onclick: () => { calSelected = ds; render(); },
    },
      el('span', { class: 'cal-num' }, d),
      info.tasks.length ? el('span', { class: `cal-count ${level}` }, info.tasks.length) : null,
      info.exams.length ? el('span', { class: 'cal-exam' }, '試') : null));
  }

  // 選んだ日の一覧
  const sel = byDay.get(calSelected) || { tasks: [], exams: [] };
  const selDate = parseYmd(calSelected);
  const selInfo = calDayInfo(selDate);
  setKids($('#task-cal'),
    el('div', { class: 'cal-head' },
      el('button', { type: 'button', class: 'cal-nav', 'aria-label': '前の月', onclick: () => { calMonth = new Date(y, m - 1, 1); render(); } }, '‹'),
      el('b', {}, `${y}年${m + 1}月`),
      el('button', { type: 'button', class: 'cal-nav', 'aria-label': '次の月', onclick: () => { calMonth = new Date(y, m + 1, 1); render(); } }, '›'),
      el('button', {
        type: 'button', class: 'link-btn',
        onclick: () => { const d = new Date(now); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); calSelected = today; render(); },
      }, '今日')),
    el('div', { class: 'cal-grid' }, ...cells),
    el('div', { class: 'cal-legend small muted' },
      el('span', {}, el('i', { class: 'sw exam-period' }), '定期試験期間'),
      el('span', {}, el('i', { class: 'sw off' }), '授業なし'),
      el('span', {}, el('b', { class: 'cal-exam-key' }, '試'), '試験の予定')),
    el('div', { class: 'cal-sel-head' },
      el('b', {}, `${fmtLongDate(selDate)}`),
      selInfo && selInfo.label ? el('span', { class: 'small muted' }, ` ${selInfo.type === 'class' ? selInfo.label : `授業なし(${selInfo.label})`}`) : null,
      el('button', { type: 'button', class: 'link-btn', onclick: () => openTodo('', null, calSelected) }, '＋ この日にやること')),
    ...sel.exams.map((x) => examRow(x, new Date(now))),
    sel.tasks.length
      ? el('ul', { class: 'task-list' }, ...sel.tasks.sort((a, b) => a.end - b.end).map((t) => renderTask(t, now)))
      : (sel.exams.length ? null : el('p', { class: 'small muted cal-none' }, 'この日が締切の課題・やることはありません。')));
}

// クリップボードにコピー(使えないときは選択してコピーする昔の方法)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/* ---------- AIに相談(Claude を開いて、頼み方の文章を渡す) ---------- */
// サーバーもAPIキーも使わない: 文章を作ってコピーし、claude.ai の新しい会話を開く
const AI_MODES = {
  idea: {
    label: '回答の方向性を提案',
    ask: [
      'この課題について、回答の方向性を提案してください。私はこれを参考に自分で考えて書くので、そのまま提出できる完成した文章ではなく、次の形で箇条書き中心にまとめてください。',
      '1. 課題が求めていることの整理',
      '2. 考えられる主張・論点の案を2〜3個(それぞれ根拠や具体例の候補も)',
      '3. 構成の案(見出しと、各段落で書くことを1行ずつ)',
      '4. 調べるとよいキーワードや資料の種類',
      '5. 書くときに気をつけること',
    ],
  },
  outline: {
    label: '構成案を作る',
    ask: [
      'この課題のレポートの構成案を作ってください。本文は書かずに、見出しと、各段落で書く内容・使えそうな根拠の種類を短く示してください。字数の指定があれば、段落ごとの字数の目安も付けてください。',
    ],
  },
  review: {
    label: '下書きを読んでアドバイス',
    ask: [
      '下の「自分の考え・メモ」は私が書いた下書きです。書き直した文章は示さずに、良い点、分かりにくい点、論理が飛んでいる所、課題の求めに合っていない所、足すとよい観点を、箇条書きで具体的に指摘してください。',
    ],
  },
  // 決まった頼み方を付けず、自分の質問をそのまま送る
  direct: { label: 'そのままClaudeに聞く', ask: [] },
  plan: {
    label: '進め方の計画',
    ask: [
      'この課題を締切までに終わらせるための進め方を、今日から締切までの日ごとのやることとして提案してください。調べる・考える・書く・見直すの時間配分も入れてください。',
    ],
  },
};

let aiTaskId = null;

function aiPrompt(t, mode, desc, mine, question = '') {
  const m = AI_MODES[mode] || AI_MODES.idea;
  const direct = mode === 'direct';
  const lines = [
    direct ? (question || 'この課題について質問させてください。') : '大学の課題について相談させてください。',
    '',
    `【課題名】${t.title}`,
    t.course ? `【授業】${t.course}` : null,
    `【締切】${fmtTaskDue(t)}(今日は${fmtLongDate(new Date())})`,
    desc ? `【課題の内容】\n${desc}` : (direct ? null : '【課題の内容】(manabaの説明をここに貼ってください)'),
    mine ? `【自分の考え・メモ】\n${mine}` : null,
    ...(m.ask.length ? ['', ...m.ask] : []),
  ];
  return lines.filter((x) => x !== null).join('\n');
}

function openAi(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  aiTaskId = id;
  const f = $('#form-ai');
  f.reset();
  f.desc.value = t.desc || '';
  f.mine.value = t.aiMine || '';
  $('#ai-q-label').hidden = true;
  setKids($('#ai-target'), el('b', {}, t.title), t.course ? ` ・ ${t.course}` : '', ` ・ 締切 ${fmtTaskDue(t)}`);
  $('#dlg-ai').showModal();
}

function currentAiPrompt() {
  const f = $('#form-ai');
  const t = state.tasks.find((x) => x.id === aiTaskId);
  if (!t) return null;
  // 貼った課題の内容とメモは保存しておく(次に開いたときも使える)
  t.desc = f.desc.value.trim();
  t.aiMine = f.mine.value.trim();
  saveState();
  return aiPrompt(t, f.mode.value, t.desc, t.aiMine, f.question.value.trim());
}

// 「そのままClaudeに聞く」を選んだときだけ質問欄を出す
$('#ai-modes').addEventListener('change', () => {
  const direct = $('#form-ai').mode.value === 'direct';
  $('#ai-q-label').hidden = !direct;
  if (direct) $('#form-ai').question.focus();
});

$('#btn-ai-copy').addEventListener('click', async () => {
  const text = currentAiPrompt();
  if (text && await copyText(text)) toast('コピーしました。Claudeに貼り付けてください');
});

$('#form-ai').addEventListener('submit', async (ev) => {
  if (ev.submitter && ev.submitter.value !== 'ok') return;
  const text = currentAiPrompt();
  if (!text) return;
  await copyText(text); // 入力欄にうまく入らなかったときは、貼り付けで使える
  const url = 'https://claude.ai/new?q=' + encodeURIComponent(text);
  window.open(url, '_blank', 'noopener');
  toast('Claudeを開きました(同じ文章をコピーもしています)');
});

/* ---------- 大学への行き方(Googleマップ) ---------- */
const CAMPUS_NAME = '文教大学 越谷キャンパス';
const CAMPUS_ADDRESS = '埼玉県越谷市南荻島3337 文教大学 越谷キャンパス';
const HOME_KEY = 'manabaPwa.home'; // 出発地はこの端末の中だけに置く(バックアップにも入れない)

function homePlace() {
  try { return localStorage.getItem(HOME_KEY) || ''; } catch { return ''; }
}

// Googleマップの経路検索URL(出発地が空なら現在地から)
function mapsUrl(mode) {
  const q = new URLSearchParams({ api: '1', destination: CAMPUS_ADDRESS, travelmode: mode });
  const home = homePlace();
  if (home) q.set('origin', home);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

// 到着時刻つきの電車の経路。
// 公式のリンク(api=1)には到着時刻がないので、Googleマップ自身が使う経路URLの data パラメータで
// 「到着(6e1)」と時刻(8j = 現地時刻をそのままUTCとみなした秒)、電車(3e3)を指定する。
function mapsArriveUrl(arrive) {
  const ts = Date.UTC(arrive.getFullYear(), arrive.getMonth(), arrive.getDate(), arrive.getHours(), arrive.getMinutes()) / 1000;
  const origin = homePlace(); // 空なら現在地から
  return `https://www.google.com/maps/dir/${encodeURIComponent(origin)}/${encodeURIComponent(CAMPUS_ADDRESS)}`
    + `/data=!4m6!4m5!2m3!6e1!7e2!8j${ts}!3e3`;
}

// Yahoo!乗換案内: 最寄りの北越谷駅に、歩く時間ぶん早く着く電車を「到着時刻」で探す
const CAMPUS_STATION = '北越谷';
const STATION_WALK_MIN = 10; // 北越谷駅からキャンパスまで徒歩約10分
function yahooArriveUrl(arrive) {
  const t = new Date(arrive.getTime() - STATION_WALK_MIN * 60000);
  const mm = String(t.getMinutes()).padStart(2, '0');
  const q = new URLSearchParams({
    from: homePlace().replace(/駅$/, ''), to: CAMPUS_STATION,
    y: String(t.getFullYear()), m: String(t.getMonth() + 1).padStart(2, '0'), d: String(t.getDate()).padStart(2, '0'),
    hh: String(t.getHours()).padStart(2, '0'), m1: mm[0], m2: mm[1],
    type: '4', // 4 = 到着時刻で検索
    ticket: 'ic',
  });
  return `https://transit.yahoo.co.jp/search/result?${q.toString()}`;
}

// 今日このあと、または次に授業がある日の最初の授業
function nextClassForCommute(now = new Date()) {
  const info = nowInfo(now);
  if (info.next) return { label: '今日', date: new Date(now), period: info.next.period, p: info.next.p, c: info.next.c };
  const n = nextClassDay(now);
  if (!n) return null;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const label = dateStr(n.date) === dateStr(tomorrow) ? '明日' : fmtLongDate(n.date);
  return { label, date: n.date, period: n.first.period, p: state.timetable.periods[n.first.period - 1], c: n.first.c };
}

// 着きたい時刻(自分で変えたときはそれを使う。初期値は次の授業の10分前)
let arriveOverride = null;
function defaultArrive(next, now) {
  if (!next || !next.p) {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d;
  }
  const [h, m] = next.p.start.split(':').map(Number);
  const d = new Date(next.date); d.setHours(h, m - 10, 0, 0);
  return d;
}

function renderCommute(now = new Date()) {
  const next = nextClassForCommute(now);
  const home = homePlace();
  const arrive = arriveOverride || defaultArrive(next, now);
  const hhmm = `${String(arrive.getHours()).padStart(2, '0')}:${String(arrive.getMinutes()).padStart(2, '0')}`;
  const a = (href, text, cls = 'btn') => el('a', { class: cls, href, target: '_blank', rel: 'noopener' }, text);
  const dateIn = el('input', { type: 'date', class: 'att-date', value: dateStr(arrive), 'aria-label': '着きたい日' });
  const timeIn = el('input', { type: 'time', class: 'att-date', value: hhmm, 'aria-label': '着きたい時刻' });
  const onChange = () => {
    if (!dateIn.value || !timeIn.value) return;
    const [y, m, d] = dateIn.value.split('-').map(Number);
    const [hh, mi] = timeIn.value.split(':').map(Number);
    arriveOverride = new Date(y, m - 1, d, hh, mi);
    renderCommute(now);
  };
  dateIn.onchange = onChange;
  timeIn.onchange = onChange;
  setKids($('#commute'),
    el('div', { class: 'commute-head' },
      el('b', {}, '🏫 大学への行き方'),
      el('button', { type: 'button', class: 'link-btn', onclick: openHome }, '出発地を設定')),
    next ? el('div', { class: 'small' }, `次の授業: ${next.label} ${next.period}限 ${next.p ? next.p.start : ''}〜 ${next.c.name}`) : null,
    el('div', { class: 'small muted' }, `行き先: ${CAMPUS_NAME} ・ 出発地: ${home || '現在地'}`),
    el('div', { class: 'commute-arrive' },
      el('span', { class: 'small' }, '着きたい時刻'), dateIn, timeIn,
      arriveOverride ? el('button', { type: 'button', class: 'link-btn', onclick: () => { arriveOverride = null; renderCommute(now); } }, '授業の10分前に戻す') : null),
    el('div', { class: 'commute-btns' },
      a(mapsArriveUrl(arrive), `Googleマップ(${hhmm}着で電車を調べる)`, 'btn primary wide'),
      a(yahooArriveUrl(arrive), `Yahoo!乗換案内(北越谷駅に${STATION_WALK_MIN}分前着)`, 'btn wide'),
      a(mapsUrl('transit'), '今すぐ出る'),
      a(mapsUrl('bicycling'), '自転車'),
      a(mapsUrl('driving'), '車'),
      a(mapsUrl('walking'), '徒歩')),
    home ? null : el('div', { class: 'small muted' }, 'Yahoo!乗換案内で調べるときは、「出発地を設定」で最寄り駅を入れておくと便利です。'));
}

function openHome() {
  const f = $('#form-home');
  f.home.value = homePlace();
  $('#dlg-home').showModal();
}

$('#form-home').addEventListener('submit', (ev) => {
  if (ev.submitter && ev.submitter.value !== 'ok') return;
  const v = ev.target.home.value.trim();
  try { if (v) localStorage.setItem(HOME_KEY, v); else localStorage.removeItem(HOME_KEY); } catch { /* 保存できない環境 */ }
  renderCommute();
  toast(v ? '出発地を保存しました' : '現在地から調べるようにしました');
});

/* ---------- 画面の切り替え ---------- */

const TAB_KEY = 'manabaPwa.tab';
let currentView = 'tasks';
try { currentView = localStorage.getItem(TAB_KEY) || 'tasks'; } catch { /* ignore */ }

const VIEWS = { today: '今日', tasks: 'やること', timetable: '時間割' };

function showView(view) {
  currentView = VIEWS[view] ? view : 'today';
  try { localStorage.setItem(TAB_KEY, currentView); } catch { /* ignore */ }
  for (const v of Object.keys(VIEWS)) $(`#view-${v}`).hidden = currentView !== v;
  // 時間割画面では ① で manaba のコース一覧(曜日表示)を開く
  $('#btn-open-manaba').href = manabaUrl(currentView === 'timetable' ? MANABA_COURSE_URL : MANABA_TODO_URL);
  $('#page-title').textContent = VIEWS[currentView];
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
  renderAll();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));

function renderAll() {
  syncTerm(state); // 開いたまま学期をまたいだときも切り替える
  render();
  renderTimetable();
  renderToday();
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
  if (parsed.kind === 'rooms') {
    toast(roomsResultText(applyRooms(parsed.days)));
    showView('timetable');
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

// アプリを開いたら、いつも「今日」から(#tasks / #timetable で直接開くこともできる)
showView(({ '#tasks': 'tasks', '#timetable': 'timetable' })[location.hash] || 'today');
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
