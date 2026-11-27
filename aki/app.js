'use strict';

/* 空き時間アプリの画面。計算は core.js。データはこの端末の localStorage だけに保存する。 */

const KEY = 'akiJikan';
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const TIMETREE_URL = 'https://timetreeapp.com/';
// ブックマーク「TimeTree取込」は Safari にあるので、ホーム画面アプリの中の簡易ブラウザではなく
// Safari 本体で開く(iOS の x-safari-https:)。
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const timetreeLink = () => (isIOS ? 'x-safari-' + TIMETREE_URL : TIMETREE_URL);
const HOUR_PX = 44;

const DEFAULT_SETTINGS = {
  weekday: { start: '08:00', end: '23:00' },
  weekend: { start: '09:00', end: '23:00' },
  minFree: 30,
  buffer: 0,
  allDayBusy: true,
};

// ---- 保存 ----
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { s = null; }
  if (!s || typeof s !== 'object') s = {};
  return {
    version: 1,
    calendars: Array.isArray(s.calendars) ? s.calendars : [],
    events: Array.isArray(s.events) ? s.events : [],
    ignored: s.ignored && typeof s.ignored === 'object' ? s.ignored : {},
    importedAt: s.importedAt || null,
    settings: {
      ...DEFAULT_SETTINGS, ...(s.settings || {}),
      weekday: { ...DEFAULT_SETTINGS.weekday, ...((s.settings || {}).weekday || {}) },
      weekend: { ...DEFAULT_SETTINGS.weekend, ...((s.settings || {}).weekend || {}) },
    },
    ui: { view: 'week', listMin: 60, ...(s.ui || {}) },
  };
}
let state = load();
function save() {
  const clean = { ...state, events: state.events.map(({ _rec, ...x }) => x) };
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { toast('保存できませんでした(容量不足の可能性があります)'); }
  cache = null;
}

// ---- 表示の道具 ----
const $ = (sel, root = document) => root.querySelector(sel);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function now() { return Date.now(); }
function hhmm(t, day) {
  // その日の24:00は「24:00」と書く
  if (day != null && t - day >= DAY) return '24:00';
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function md(t) { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; }
function dur(ms) {
  const m = Math.round(ms / MIN);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}分`;
  return r ? `${h}時間${r}分` : `${h}時間`;
}
function hoursShort(ms) {
  const h = ms / 3600000;
  if (h <= 0) return '0';
  return (Math.round(h * 2) / 2).toString().replace(/\.0$/, '');
}
function relDay(day) {
  const n = Math.round((day - startOfDay(now())) / DAY);
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n === 2) return 'あさって';
  return '';
}
function weekStart(t) { const d = new Date(startOfDay(t)); return addDays(d.getTime(), -((d.getDay() + 6) % 7)); } // 月曜はじまり
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 下で予備の方法 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// ---- 計算(表示する期間ごとにまとめて計算して使い回す) ----
let cache = null;
function usedCalendars() {
  const set = new Set();
  for (const c of state.calendars) if (c.use !== false) set.add(c.id);
  return set;
}
function computeDays(from, days) {
  const key = `${from}:${days}:${Math.floor(now() / MIN)}`;
  if (cache && cache.key === key) return cache.result;
  const to = addDays(from, days);
  const use = usedCalendars();
  const occ = [];
  for (const ev of state.events) {
    if (!use.has(ev.cal) || state.ignored[ev.id]) continue;
    for (const o of expandEvent(ev, from, to)) occ.push(o);
  }
  occ.sort((a, b) => a.s - b.s || (b.e - b.s) - (a.e - a.s));
  const t = now();
  const today = startOfDay(t);
  const result = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    const next = addDays(day, 1);
    const list = occ.filter((o) => o.s < next && o.e > day);
    const win = dayWindow(day, state.settings);
    const past = day < today;
    const free = past ? [] : freeSlots(day, list, state.settings, day === today ? t : null);
    const total = free.reduce((a, f) => a + (f.e - f.s), 0);
    result.push({ day, win, occ: list, free, total, past });
  }
  cache = { key, result };
  return result;
}
function dayInfo(day) { return computeDays(day, 1)[0]; }
function calName(id) { const c = state.calendars.find((x) => x.id === id); return c ? c.name : ''; }

// ---- 画面全体 ----
function render() {
  const has = state.events.length > 0 || state.calendars.length > 0;
  $('#empty').hidden = has;
  renderSummary();
  for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.view === state.ui.view);
  for (const v of ['week', 'month', 'list']) $(`#panel-${v}`).hidden = state.ui.view !== v;
  if (state.ui.view === 'week') renderWeek();
  else if (state.ui.view === 'month') renderMonth();
  else renderList();
}

function renderSummary() {
  const el = $('#summary');
  if (!state.importedAt) { el.hidden = true; return; }
  el.hidden = false;
  const t = now();
  const today = startOfDay(t);
  const days = computeDays(today, 14);
  const d0 = days[0];
  let next = null;
  for (const d of days) {
    const f = d.free.find((x) => x.e > t);
    if (f) { next = { d, f }; break; }
  }
  const ago = t - state.importedAt;
  const agoText = ago < 3600000 ? `${Math.max(1, Math.round(ago / MIN))}分前` : ago < DAY ? `${Math.round(ago / 3600000)}時間前` : `${Math.round(ago / DAY)}日前`;
  el.innerHTML = `
    <div class="sum-row">
      <div>
        <div class="sum-label">今日 ${esc(md(today))} の空き(これから)</div>
        <div class="sum-big">${d0.total ? esc(dur(d0.total)) : 'なし'}</div>
      </div>
      <div class="sum-next">
        <div class="sum-label">次の空き</div>
        ${next ? `<button type="button" class="link" data-day="${next.d.day}">${esc(relDay(next.d.day) || md(next.d.day))} ${esc(hhmm(next.f.s))}〜${esc(hhmm(next.f.e, next.d.day))}<br><span class="small">(${esc(dur(next.f.e - next.f.s))})</span></button>` : '<span class="muted">2週間以内になし</span>'}
      </div>
    </div>
    <div class="small ${ago > 3 * DAY ? 'warn' : 'muted'}">TimeTreeの取り込み: ${esc(agoText)}${ago > 3 * DAY ? '(予定が変わっているかもしれません。取り込み直してください)' : ''}</div>`;
}

// ---- 週 ----
function hourRange() {
  const s = state.settings;
  const a = Math.min(hm(s.weekday.start), hm(s.weekend.start));
  const endOf = (w) => (hm(w.end) <= hm(w.start) ? 1440 : hm(w.end));
  const b = Math.max(endOf(s.weekday), endOf(s.weekend));
  return { from: Math.floor(a / 60), to: Math.ceil(b / 60) };
}
function renderWeek() {
  const el = $('#panel-week');
  const ws = addDays(weekStart(now()), (state.ui.weekOffset || 0) * 7);
  const days = computeDays(ws, 7);
  const { from, to } = hourRange();
  const h = (to - from) * HOUR_PX;
  const y = (day, t) => ((t - day) / MIN / 60 - from) * HOUR_PX;
  const today = startOfDay(now());
  const weekTotal = days.reduce((a, d) => a + d.total, 0);

  let hours = '';
  for (let i = from; i <= to; i++) hours += `<div class="hr" style="top:${(i - from) * HOUR_PX}px">${i}</div>`;
  let lines = '';
  for (let i = from + 1; i < to; i++) lines += `<div class="hline" style="top:${(i - from) * HOUR_PX}px"></div>`;

  const cols = days.map((d) => {
    let inner = lines;
    // 時間帯の外(早朝・深夜)は薄く
    const ws0 = y(d.day, d.win.s);
    const we0 = y(d.day, d.win.e);
    if (ws0 > 0) inner += `<div class="off" style="top:0;height:${ws0}px"></div>`;
    if (we0 < h) inner += `<div class="off" style="top:${we0}px;height:${h - we0}px"></div>`;
    for (const o of d.occ) {
      if (o.ev.allDay) continue;
      const top = Math.max(0, y(d.day, Math.max(o.s, d.day)));
      const bot = Math.min(h, y(d.day, Math.min(o.e, addDays(d.day, 1))));
      if (bot <= 0 || top >= h) continue;
      inner += `<button type="button" class="busy" data-ev="${esc(o.ev.id)}" data-s="${o.s}" style="top:${top}px;height:${Math.max(14, bot - top)}px"><span>${esc(o.ev.title)}</span></button>`;
    }
    for (const f of d.free) {
      const top = y(d.day, f.s);
      const ht = y(d.day, f.e) - top;
      inner += `<button type="button" class="free" data-day="${d.day}" style="top:${top}px;height:${ht}px">${ht >= 30 ? `<span>${esc(hhmm(f.s))}<br>${esc(hoursShort(f.e - f.s))}h</span>` : ''}</button>`;
    }
    if (d.day === today) {
      const ny = y(d.day, now());
      if (ny > 0 && ny < h) inner += `<div class="nowline" style="top:${ny}px"></div>`;
    }
    const allDay = d.occ.filter((o) => o.ev.allDay);
    const wd = new Date(d.day).getDay();
    return `
      <div class="wcol${d.past ? ' past' : ''}">
        <button type="button" class="whead${d.day === today ? ' today' : ''}${wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''}" data-day="${d.day}">
          <span class="wd">${WEEK[wd]}</span><span class="dn">${new Date(d.day).getDate()}</span>
          <span class="wt">${d.past ? '' : `${esc(hoursShort(d.total))}h`}</span>
        </button>
        <div class="allday">${allDay.map((o) => `<button type="button" class="chip" data-ev="${esc(o.ev.id)}" data-s="${o.s}">${esc(o.ev.title)}</button>`).join('')}</div>
        <div class="wbody" style="height:${h}px">${inner}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="nav">
      <button type="button" class="btn" data-week="-1" aria-label="前の週">‹</button>
      <button type="button" class="nav-title" data-week="0">${esc(md(ws))} 〜 ${esc(md(addDays(ws, 6)))}</button>
      <button type="button" class="btn" data-week="1" aria-label="次の週">›</button>
    </div>
    <p class="small muted center">この週の空き: <b>${esc(dur(weekTotal))}</b>(${state.settings.minFree}分以上のすき間)</p>
    <div class="week">
      <div class="hours"><div class="whead-sp"></div><div class="allday-sp"></div><div class="hcol" style="height:${h}px">${hours}</div></div>
      ${cols}
    </div>
    <div class="legend"><span class="lg lg-free"></span>空き <span class="lg lg-busy"></span>予定 <span class="lg lg-off"></span>時間外(設定で変更)</div>`;
  // 全日の行の高さをそろえる
  const ad = el.querySelectorAll('.allday');
  const mh = Math.max(0, ...[...ad].map((x) => x.scrollHeight));
  for (const x of ad) x.style.height = `${mh}px`;
  el.querySelector('.allday-sp').style.height = `${mh}px`;
}

// ---- 月 ----
function renderMonth() {
  const el = $('#panel-month');
  const base = new Date(now());
  const m0 = new Date(base.getFullYear(), base.getMonth() + (state.ui.monthOffset || 0), 1).getTime();
  const gridStart = weekStart(m0);
  const days = computeDays(gridStart, 42);
  const month = new Date(m0).getMonth();
  const today = startOfDay(now());
  let cells = '';
  for (const d of days) {
    const dt = new Date(d.day);
    const inMonth = dt.getMonth() === month;
    const winLen = Math.max(1, d.win.e - d.win.s);
    const ratio = d.total / winLen;
    const lv = d.past ? 'p' : d.total === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
    const busyN = d.occ.length;
    cells += `<button type="button" class="mcell lv${lv}${inMonth ? '' : ' out'}${d.day === today ? ' today' : ''}" data-day="${d.day}">
      <span class="mdn">${dt.getDate()}</span>
      <span class="mh">${d.past ? '' : `${esc(hoursShort(d.total))}h`}</span>
      ${busyN ? `<span class="mdots">${'•'.repeat(Math.min(busyN, 4))}</span>` : ''}
    </button>`;
  }
  el.innerHTML = `
    <div class="nav">
      <button type="button" class="btn" data-month="-1" aria-label="前の月">‹</button>
      <button type="button" class="nav-title" data-month="0">${new Date(m0).getFullYear()}年${month + 1}月</button>
      <button type="button" class="btn" data-month="1" aria-label="次の月">›</button>
    </div>
    <div class="mgrid">${['月', '火', '水', '木', '金', '土', '日'].map((w) => `<div class="mwd">${w}</div>`).join('')}${cells}</div>
    <div class="legend">空きの多さ: <span class="lg lv0"></span>なし <span class="lg lv1"></span> <span class="lg lv2"></span> <span class="lg lv3"></span> <span class="lg lv4"></span>多い ・数字は空きの時間</div>`;
}

// ---- リスト ----
const LIST_MINS = [30, 60, 120, 180, 240];
function filteredDays(min) {
  return computeDays(startOfDay(now()), 14).map((d) => ({ ...d, free: d.free.filter((f) => f.e - f.s >= min * MIN) }));
}
function shareText(days) {
  const lines = [];
  for (const d of days) {
    if (!d.free.length) continue;
    const full = d.free.length === 1 && d.free[0].s <= d.win.s && d.free[0].e >= d.win.e;
    lines.push(`${md(d.day)} ${full ? '終日OK' : d.free.map((f) => `${hhmm(f.s)}〜${hhmm(f.e, d.day)}`).join(', ')}`);
  }
  return lines.length ? `空いている時間\n${lines.join('\n')}` : '';
}
function renderList() {
  const el = $('#panel-list');
  const min = state.ui.listMin || 60;
  const days = filteredDays(min);
  el.innerHTML = `
    <div class="chips">${LIST_MINS.map((m) => `<button type="button" class="fchip${m === min ? ' on' : ''}" data-min="${m}">${m < 60 ? `${m}分` : `${m / 60}時間`}以上</button>`).join('')}</div>
    <ul class="dlist">
      ${days.map((d) => `
        <li>
          <button type="button" class="dl-head" data-day="${d.day}">
            <span>${esc(md(d.day))} <span class="small muted">${esc(relDay(d.day))}</span></span>
            <span class="small ${d.free.length ? '' : 'muted'}">${d.free.length ? `計 ${esc(dur(d.free.reduce((a, f) => a + f.e - f.s, 0)))}` : '空きなし'}</span>
          </button>
          ${d.free.map((f) => `<div class="slot"><span class="bar" style="width:${Math.min(100, ((f.e - f.s) / (d.win.e - d.win.s)) * 100)}%"></span><span class="st">${esc(hhmm(f.s))}〜${esc(hhmm(f.e, d.day))}</span><span class="sd">${esc(dur(f.e - f.s))}</span></div>`).join('')}
        </li>`).join('')}
    </ul>
    <button type="button" class="btn primary wide" id="copy-list">この空き時間をコピー(LINEなどに貼れます)</button>`;
}

// ---- シート(下から出る画面) ----
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  const d = $('#sheet');
  if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
}
function closeSheet() { const d = $('#sheet'); if (d.close) d.close(); else d.removeAttribute('open'); }

function openDay(day) {
  const d = dayInfo(day);
  const items = [];
  for (const o of d.occ) items.push({ s: o.s, e: o.e, ev: o.ev, all: o.ev.allDay });
  for (const f of d.free) items.push({ s: f.s, e: f.e, free: true });
  items.sort((a, b) => (b.all ? 1 : 0) - (a.all ? 1 : 0) || a.s - b.s);
  const row = (x) => {
    if (x.free) return `<li class="tl tl-free"><span class="tt">${esc(hhmm(x.s))}〜${esc(hhmm(x.e, day))}</span><b>空き ${esc(dur(x.e - x.s))}</b></li>`;
    const time = x.all ? '終日' : `${x.s < day ? '前日〜' : hhmm(x.s)}〜${x.e > addDays(day, 1) ? '翌日' : hhmm(x.e, day)}`;
    return `<li class="tl"><span class="tt">${esc(time)}</span><button type="button" class="link" data-ev="${esc(x.ev.id)}" data-s="${x.s}">${esc(x.ev.title)}</button> <span class="small muted">${esc(calName(x.ev.cal))}</span></li>`;
  };
  const text = shareText([d]);
  openSheet(`${md(day)}${relDay(day) ? `(${relDay(day)})` : ''}`, `
    <p class="small muted">空き時間を数える時間帯: ${esc(hhmm(d.win.s))}〜${esc(hhmm(d.win.e, day))}</p>
    <ul class="timeline">${items.length ? items.map(row).join('') : '<li class="muted">予定も空きもありません</li>'}</ul>
    ${text ? `<button type="button" class="btn primary wide" data-copy="${esc(text)}">この日の空き時間をコピー</button>` : ''}`);
}

function openEvent(id, s) {
  const ev = state.events.find((x) => x.id === id);
  if (!ev) return;
  const start = Number(s) || ev.s;
  const end = start + (ev.e - ev.s);
  const when = ev.allDay
    ? `${md(start)}${end - start > DAY ? ` 〜 ${md(end - DAY)}` : ''} 終日`
    : `${md(start)} ${hhmm(start)} 〜 ${startOfDay(end) !== startOfDay(start) ? md(end) + ' ' : ''}${hhmm(end)}`;
  openSheet('予定', `
    <p class="ev-title">${esc(ev.title)}</p>
    <p>${esc(when)}${ev.rec ? ' <span class="small muted">(くり返し)</span>' : ''}</p>
    <p class="small muted">カレンダー: ${esc(calName(ev.cal))}</p>
    <label class="check"><input type="checkbox" data-ignore="${esc(ev.id)}" ${state.ignored[ev.id] ? 'checked' : ''}> この予定があっても「空き」として数える</label>
    <p class="small muted">「リマインダー的な予定」「行かなくてもいい予定」などに使います。くり返しの予定は全部の回が対象です。</p>`);
}

function openImport() {
  openSheet('予定を取り込む', `
    <h3>TimeTreeから</h3>
    <ol class="steps">
      <li><a class="btn wide" href="${timetreeLink()}" target="_blank" rel="noopener">① TimeTreeを開く</a><span class="small muted">SafariでTimeTreeが開きます。最初の1回は右上の「≡」→「ログイン」でログイン(紹介ページのままでも、ログインしていれば取り込めます)</span></li>
      <li>ブックマークから「<b>TimeTree取込</b>」→「<b>コピー</b>」<br><a class="small" href="bookmarklet.html">ブックマークの設定(最初に1回だけ)</a></li>
      <li><button type="button" class="btn primary wide" id="paste-import">② 貼り付けて取り込む</button><span class="small muted">「ペースト」の確認が出たら押してください</span></li>
    </ol>
    <details>
      <summary class="small muted">うまく貼り付けられないとき</summary>
      <textarea id="paste-area" rows="4" placeholder="ここを長押しして「ペースト」"></textarea>
      <button type="button" class="btn wide" id="paste-area-import">この内容で取り込む</button>
    </details>
    <h3>ファイルから(.ics)</h3>
    <p class="small muted">Googleカレンダー・iPhoneのカレンダーなどから書き出した .ics ファイルも読み込めます。ファイルごとに1つのカレンダーとして追加されます(同じ名前のファイルは置き換え)。</p>
    <label class="btn wide file-btn">📄 .ics ファイルを選ぶ<input type="file" id="ics-file" accept=".ics,text/calendar" multiple hidden></label>`);
}

function openSettings() {
  const s = state.settings;
  const opt = (vals, cur, fmt) => vals.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${fmt(v)}</option>`).join('');
  const cals = state.calendars.map((c) => {
    const n = state.events.filter((e) => e.cal === c.id).length;
    return `<li><label class="check"><input type="checkbox" data-cal="${esc(c.id)}" ${c.use !== false ? 'checked' : ''}> ${esc(c.name)} <span class="small muted">${esc(c.source)}・${n}件</span></label>
      ${c.source === 'ファイル' ? `<button type="button" class="link small danger" data-delcal="${esc(c.id)}">削除</button>` : ''}</li>`;
  }).join('');
  const ign = state.events.filter((e) => state.ignored[e.id]);
  openSheet('設定', `
    <h3>空き時間を数える時間帯</h3>
    <div class="form-row"><span>平日</span><input type="time" data-set="weekday.start" value="${esc(s.weekday.start)}"> 〜 <input type="time" data-set="weekday.end" value="${esc(s.weekday.end)}"></div>
    <div class="form-row"><span>土日</span><input type="time" data-set="weekend.start" value="${esc(s.weekend.start)}"> 〜 <input type="time" data-set="weekend.end" value="${esc(s.weekend.end)}"></div>
    <p class="small muted">終わりを 0:00 にすると24時まで。寝ている時間などを外せます。</p>
    <h3>空き時間の条件</h3>
    <div class="form-row"><span>短いすき間を除く</span><select data-set="minFree">${opt([15, 30, 60, 90, 120], s.minFree, (v) => `${v}分未満`)}</select></div>
    <div class="form-row"><span>予定の前後に空ける</span><select data-set="buffer">${opt([0, 15, 30, 45, 60, 90], s.buffer, (v) => (v ? `${v}分(移動など)` : 'なし'))}</select></div>
    <label class="check"><input type="checkbox" data-set="allDayBusy" ${s.allDayBusy ? 'checked' : ''}> 終日の予定がある日は空きなしにする</label>
    <h3>カレンダー</h3>
    ${cals ? `<p class="small muted">チェックを外したカレンダーの予定は、空き時間の計算に入れません(家族の予定など)。</p><ul class="cal-list">${cals}</ul>` : '<p class="small muted">まだ取り込んでいません。</p>'}
    ${ign.length ? `<h3>空きとして数える予定</h3><ul class="cal-list">${ign.map((e) => `<li><span>${esc(e.title)}</span> <button type="button" class="link small" data-unignore="${esc(e.id)}">元に戻す</button></li>`).join('')}</ul>` : ''}
    <h3>データ</h3>
    <p class="small muted">予定はこの端末の中だけに保存され、どこにも送信しません。</p>
    <button type="button" class="btn wide danger" id="clear-all">取り込んだ予定をすべて消す</button>`);
}

// ---- 取り込み ----
function applyImport(cals, events, replace) {
  // replace(cal) が true のカレンダーの予定を入れ替える。チェックの状態は引き継ぐ
  const prevUse = Object.fromEntries(state.calendars.map((c) => [c.id, c.use]));
  state.calendars = state.calendars.filter((c) => !replace(c.id) && !cals.some((n) => n.id === c.id));
  state.events = state.events.filter((e) => !replace(e.cal) && !cals.some((n) => n.id === e.cal));
  for (const c of cals) state.calendars.push({ ...c, use: prevUse[c.id] ?? true });
  state.events.push(...events);
  // もう存在しない予定の「空きとして数える」は消す
  const ids = new Set(state.events.map((e) => e.id));
  for (const id of Object.keys(state.ignored)) if (!ids.has(id)) delete state.ignored[id];
  state.importedAt = now();
  save();
}

function importText(text) {
  let data;
  try { data = JSON.parse(String(text).trim()); } catch { data = null; }
  if (!data && /BEGIN:VCALENDAR/.test(text)) { importIcs(text, 'ics:paste', '貼り付けたカレンダー'); return true; }
  if (!data || data.kind !== 'aki-timetree') {
    toast('TimeTreeのデータではありません。ブックマーク「TimeTree取込」で「コピー」してから押してください');
    return false;
  }
  const { calendars, events } = normalizeTimeTree(data);
  applyImport(calendars, events, (id) => id.startsWith('tt:'));
  closeSheet();
  render();
  toast(`取り込みました(${calendars.length}カレンダー・${events.length}件)`);
  return true;
}

function importIcs(text, calId, name) {
  const { calendars, events } = parseIcs(text, calId, name);
  applyImport(calendars, events, (id) => id === calId);
  closeSheet();
  render();
  toast(`「${calendars[0].name}」を読み込みました(${events.length}件)`);
}

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---- 操作 ----
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-close]');
  if (!t) return;
  if (t.matches('[data-close]')) { closeSheet(); return; }
  if (t.id === 'btn-import') { openImport(); return; }
  if (t.id === 'btn-settings') { openSettings(); return; }
  if (t.dataset.view) { state.ui.view = t.dataset.view; save(); render(); return; }
  if (t.dataset.week !== undefined) { state.ui.weekOffset = t.dataset.week === '0' ? 0 : (state.ui.weekOffset || 0) + Number(t.dataset.week); save(); render(); return; }
  if (t.dataset.month !== undefined) { state.ui.monthOffset = t.dataset.month === '0' ? 0 : (state.ui.monthOffset || 0) + Number(t.dataset.month); save(); render(); return; }
  if (t.dataset.min) { state.ui.listMin = Number(t.dataset.min); save(); render(); return; }
  if (t.dataset.ev) { openEvent(t.dataset.ev, t.dataset.s); return; }
  if (t.dataset.day) { openDay(Number(t.dataset.day)); return; }
  if (t.dataset.copy) { toast((await copyText(t.dataset.copy)) ? 'コピーしました' : 'コピーできませんでした'); return; }
  if (t.id === 'copy-list') {
    const text = shareText(filteredDays(state.ui.listMin || 60));
    if (!text) { toast('この条件の空き時間はありません'); return; }
    toast((await copyText(text)) ? 'コピーしました' : 'コピーできませんでした');
    return;
  }
  if (t.id === 'paste-import') {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { toast('貼り付けできませんでした。「うまく貼り付けられないとき」の欄を使ってください'); return; }
    importText(text);
    return;
  }
  if (t.id === 'paste-area-import') { importText($('#paste-area').value); return; }
  if (t.dataset.unignore) { delete state.ignored[t.dataset.unignore]; save(); render(); openSettings(); return; }
  if (t.dataset.delcal) {
    if (!confirm('このカレンダーを削除しますか?')) return;
    const id = t.dataset.delcal;
    state.calendars = state.calendars.filter((c) => c.id !== id);
    state.events = state.events.filter((x) => x.cal !== id);
    save(); render(); openSettings();
    return;
  }
  if (t.id === 'clear-all') {
    if (!confirm('取り込んだ予定と設定したカレンダーをすべて消しますか?')) return;
    state.calendars = []; state.events = []; state.ignored = {}; state.importedAt = null;
    save(); closeSheet(); render();
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.set) {
    const path = t.dataset.set.split('.');
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.tagName === 'SELECT') v = Number(v);
    if (t.type === 'time' && !v) return;
    if (path.length === 2) state.settings[path[0]][path[1]] = v;
    else state.settings[path[0]] = v;
    save(); render();
    return;
  }
  if (t.dataset.cal) {
    const c = state.calendars.find((x) => x.id === t.dataset.cal);
    if (c) c.use = t.checked;
    save(); render();
    return;
  }
  if (t.dataset.ignore) {
    if (t.checked) state.ignored[t.dataset.ignore] = true;
    else delete state.ignored[t.dataset.ignore];
    save(); render();
    return;
  }
  if (t.id === 'ics-file') {
    for (const f of t.files) {
      const text = await f.text();
      importIcs(text, 'ics:' + hashId(f.name), f.name.replace(/\.ics$/i, ''));
    }
  }
});

// 下に引いて閉じる代わりに、外側を押したら閉じる
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

// Safari で開いたとき用: #import=... で直接取り込む
function importFromHash() {
  const m = location.hash.match(/^#import=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try { importText(decodeURIComponent(m[1])); } catch { toast('取り込めませんでした'); }
}

render();
importFromHash();
// 時間がたつと「これから」の空きが変わるので、1分ごと・画面に戻ったときに描き直す
setInterval(() => { if (!document.hidden && !$('#sheet').open) render(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
