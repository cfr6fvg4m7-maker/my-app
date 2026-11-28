'use strict';

/* ============================================================
 * 空き時間アプリの計算部分(画面なし)
 *  - TimeTree / ICS の予定を同じ形にそろえる
 *  - 繰り返し予定(RRULE / EXDATE)を期間内に展開する
 *  - 1日ごとの空き時間を求める
 * 予定の形: { id, cal, title, allDay, s, e, rec?: [文字列], exdates?: [ms], uid?, recurId? }
 *   s / e はこの端末の時刻のミリ秒。終日の予定は s = 初日の0時、e = 最終日の翌日0時。
 * ============================================================ */

const DAY = 86400000;
const MIN = 60000;

// ---- 日付の道具 ----
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDayKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
function hm(str) { const [h, m] = String(str).split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }

// ---- タイムゾーン ----
const tzCache = {};
function tzParts(ms, tz) {
  let f = tzCache[tz];
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
      });
    } catch { f = null; }
    tzCache[tz] = f;
  }
  if (!f) return null;
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return p;
}
// tz での壁時計の時刻 → 実際の時刻(ms)
function zonedToMs(y, mo, d, h, mi, s, tz) {
  if (!tz || tz === 'UTC' || tz === 'Etc/UTC') return Date.UTC(y, mo - 1, d, h, mi, s);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const p = tzParts(guess, tz);
  if (!p) return new Date(y, mo - 1, d, h, mi, s).getTime(); // 知らないタイムゾーンは端末の時刻として扱う
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return guess - (asUtc - guess);
}
// ms を tz で見たときの日付 → 端末の時刻での0時
function localMidnightOf(ms, tz) {
  const p = tz ? tzParts(ms, tz) : null;
  if (!p) return startOfDay(ms);
  return new Date(p.year, p.month - 1, p.day).getTime();
}

// ---- ICS の日時 ----
// 値 "20261127T090000Z" / "20261127T090000"(+TZID) / "20261127"(VALUE=DATE)
function parseIcsTime(value, params = {}) {
  const v = String(value).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: true, ms: new Date(+y, +mo - 1, +d).getTime() };
  if (z) return { date: false, ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)) };
  if (params.TZID) return { date: false, ms: zonedToMs(+y, +mo, +d, +h, +mi, +(s || 0), params.TZID) };
  return { date: false, ms: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime() };
}

// "NAME;PARAM=x:VALUE" → { name, params, value }
function parseContentLine(line) {
  let i = 0; let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.split(';');
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function unescapeText(s) {
  return String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseDuration(v) {
  const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * DAY) + ((+d || 0) * DAY) + ((+h || 0) * 3600000) + ((+mi || 0) * MIN) + ((+s || 0) * 1000);
  return sign === '-' ? -ms : ms;
}

// 繰り返しの行(RRULE / EXDATE / RDATE)を { rrule, exdates, rdates } に
function parseRecurrenceLines(lines) {
  const out = { rrule: null, exdates: [], rdates: [] };
  for (const raw of lines || []) {
    const { name, params, value } = parseContentLine(String(raw).trim());
    if (name === 'RRULE') out.rrule = parseRRule(value);
    else if (name === 'EXDATE' || name === 'RDATE') {
      for (const v of value.split(',')) {
        const t = parseIcsTime(v, params);
        if (t) (name === 'EXDATE' ? out.exdates : out.rdates).push(t);
      }
    }
  }
  return out;
}

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function parseRRule(v) {
  const r = { freq: null, interval: 1, count: null, until: null, byday: null, bymonthday: null, bymonth: null, wkst: 1 };
  for (const part of String(v).split(';')) {
    const [k, val] = part.split('=');
    if (!val) continue;
    switch (k.toUpperCase()) {
      case 'FREQ': r.freq = val.toUpperCase(); break;
      case 'INTERVAL': r.interval = Math.max(1, parseInt(val, 10) || 1); break;
      case 'COUNT': r.count = parseInt(val, 10) || null; break;
      case 'UNTIL': { const t = parseIcsTime(val); if (t) r.until = t.date ? t.ms + DAY - 1 : t.ms; break; }
      case 'BYDAY':
        r.byday = val.split(',').map((x) => {
          const m = x.trim().toUpperCase().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
          return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2]] } : null;
        }).filter(Boolean);
        break;
      case 'BYMONTHDAY': r.bymonthday = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x); break;
      case 'BYMONTH': r.bymonth = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x); break;
      case 'WKST': r.wkst = WD[val.toUpperCase()] ?? 1; break;
      default: break;
    }
  }
  return r.freq ? r : null;
}

// その日が繰り返しの規則に合うか(start は最初の回の0時)
function matchesRule(r, start, day) {
  const sd = new Date(start);
  const d = new Date(day);
  if (r.bymonth && !r.bymonth.includes(d.getMonth() + 1)) return false;
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const dayOk = (defaultCheck) => {
    if (r.bymonthday) {
      return r.bymonthday.some((n) => (n > 0 ? n : dim + n + 1) === d.getDate());
    }
    if (r.byday) {
      return r.byday.some(({ n, wd }) => {
        if (wd !== d.getDay()) return false;
        if (!n || r.freq === 'WEEKLY' || r.freq === 'DAILY') return true;
        const nth = Math.floor((d.getDate() - 1) / 7) + 1;
        const nthFromEnd = Math.floor((dim - d.getDate()) / 7) + 1;
        return n > 0 ? nth === n : nthFromEnd === -n;
      });
    }
    return defaultCheck();
  };
  switch (r.freq) {
    case 'DAILY':
      return daysBetween(start, day) % r.interval === 0 && dayOk(() => true);
    case 'WEEKLY': {
      const ws = (t) => { const x = new Date(t); return addDays(startOfDay(t), -((x.getDay() - r.wkst + 7) % 7)); };
      const weeks = Math.round(daysBetween(ws(start), ws(day)) / 7);
      if (weeks % r.interval !== 0) return false;
      if (r.byday) return r.byday.some(({ wd }) => wd === d.getDay());
      return d.getDay() === sd.getDay();
    }
    case 'MONTHLY': {
      const months = (d.getFullYear() - sd.getFullYear()) * 12 + d.getMonth() - sd.getMonth();
      if (months % r.interval !== 0) return false;
      return dayOk(() => d.getDate() === sd.getDate());
    }
    case 'YEARLY': {
      const years = d.getFullYear() - sd.getFullYear();
      if (years % r.interval !== 0) return false;
      if (!r.bymonth && d.getMonth() !== sd.getMonth()) return false; // 月の指定がなければ最初の回の月
      return dayOk(() => d.getDate() === sd.getDate());
    }
    default:
      return false;
  }
}

// 予定を [from, to) と重なる回に展開する → [{ s, e, ev }]
function expandEvent(ev, from, to) {
  const out = [];
  const dur = Math.max(0, ev.e - ev.s);
  const rec = ev._rec || (ev._rec = parseRecurrenceLines(ev.rec));
  const exAll = (ev.exdates || []).map((ms) => ({ date: false, ms })).concat(rec.exdates);
  const isEx = (s) => exAll.some((x) => (x.date ? dayKey(x.ms) === dayKey(s) : Math.abs(x.ms - s) < MIN));
  const push = (s) => { if (s < to && s + dur > from && !isEx(s)) out.push({ s, e: s + dur, ev }); };

  if (!rec.rrule) {
    push(ev.s);
  } else {
    const r = rec.rrule;
    const start0 = startOfDay(ev.s);
    const st = new Date(ev.s);
    const limit = Math.min(to, r.until != null ? r.until + 1 : Infinity);
    let count = 0;
    // COUNT があるときは最初の回から数える。ないときは期間の少し前から調べる
    let day = r.count ? start0 : Math.max(start0, startOfDay(from - dur - DAY));
    let guard = 0;
    while (guard++ < 40000) {
      const d = new Date(day);
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), st.getHours(), st.getMinutes(), st.getSeconds()).getTime();
      const sAdj = ev.allDay ? day : s;
      if (sAdj >= limit) break;
      if (day === start0 || matchesRule(r, start0, day)) {
        count++;
        push(sAdj);
        if (r.count && count >= r.count) break;
      }
      day = addDays(day, 1);
    }
  }
  for (const rd of rec.rdates) {
    const s = rd.date ? rd.ms + (ev.allDay ? 0 : ev.s - startOfDay(ev.s)) : rd.ms;
    push(s);
  }
  return out;
}

// ---- 取り込みデータをそろえる ----
// TimeTree(ブックマークレットの出力) → 予定の配列
function normalizeTimeTree(data) {
  const events = [];
  for (const x of data.events || []) {
    let s; let e;
    if (x.allDay) {
      s = localMidnightOf(x.s, x.stz || 'UTC');
      // TimeTree の終日の終わりは「最終日」なので、翌日0時にする
      e = addDays(localMidnightOf(x.e, x.etz || x.stz || 'UTC'), 1);
      if (e <= s) e = addDays(s, 1);
    } else {
      s = x.s; e = Math.max(x.e, x.s);
    }
    events.push({ id: 'tt:' + x.id, cal: 'tt:' + x.cal, title: x.title || '(タイトルなし)', allDay: !!x.allDay, s, e, rec: x.rec, parent: x.parent ? 'tt:' + x.parent : undefined });
  }
  const calendars = (data.calendars || []).map((c) => ({ id: 'tt:' + c.id, name: c.name, source: 'TimeTree' }));
  return { calendars, events };
}

// manaba課題アプリの「空き時間アプリに送る」→ 予定の配列(カレンダー「授業」1つ)
const CLASS_CAL = 'mb:classes';
function normalizeClasses(data) {
  const events = [];
  for (const x of data.items || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !x.start || !x.end) continue;
    const day = parseDayKey(x.date);
    const s = day + hm(x.start) * MIN;
    const e = day + hm(x.end) * MIN;
    if (e <= s) continue;
    events.push({
      id: `mb:${x.date}-${x.period}${x.exam ? 'x' : ''}`, cal: CLASS_CAL, title: x.title || `${x.period}限`, allDay: false, s, e,
      note: [x.period ? `${x.period}限` : '', x.room ? `教室: ${x.room}` : ''].filter(Boolean).join(' ・ ') || undefined,
    });
  }
  return { calendars: [{ id: CLASS_CAL, name: '授業(manaba)', source: 'manaba' }], events };
}

// ICS ファイルの中身 → { calendars, events }(ファイル1つ = カレンダー1つ)
function parseIcs(text, calId, fallbackName) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let name = '';
  let cur = null;
  for (const line of lines) {
    if (!line) continue;
    const { name: key, params, value } = parseContentLine(line);
    if (key === 'BEGIN' && value.toUpperCase() === 'VEVENT') { cur = { rec: [], params: {} }; continue; }
    if (key === 'END' && value.toUpperCase() === 'VEVENT') {
      if (cur && cur.start) {
        const allDay = cur.start.date;
        let e;
        if (cur.end) e = cur.end.ms;
        else if (cur.duration) e = cur.start.ms + cur.duration;
        else e = allDay ? addDays(cur.start.ms, 1) : cur.start.ms;
        if (cur.status !== 'CANCELLED' && cur.transp !== 'TRANSPARENT') {
          events.push({
            id: `${calId}:${cur.uid || events.length}${cur.recurId ? '@' + cur.recurId.ms : ''}`,
            cal: calId, title: cur.summary || '(タイトルなし)', allDay, s: cur.start.ms, e: Math.max(e, cur.start.ms),
            rec: cur.rec.length ? cur.rec : undefined, uid: cur.uid, recurId: cur.recurId ? cur.recurId.ms : undefined,
          });
        } else if (cur.recurId) {
          // 繰り返しのうち1回だけ取り消し → 元の回を消すために印だけ残す
          events.push({ id: `${calId}:${cur.uid}@${cur.recurId.ms}`, cal: calId, cancelled: true, uid: cur.uid, recurId: cur.recurId.ms, s: 0, e: 0 });
        }
      }
      cur = null; continue;
    }
    if (!cur) { if (key === 'X-WR-CALNAME') name = unescapeText(value); continue; }
    switch (key) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.summary = unescapeText(value); break;
      case 'DTSTART': cur.start = parseIcsTime(value, params); break;
      case 'DTEND': cur.end = parseIcsTime(value, params); break;
      case 'DURATION': cur.duration = parseDuration(value); break;
      case 'RRULE': case 'EXDATE': case 'RDATE': cur.rec.push(line); break;
      case 'RECURRENCE-ID': cur.recurId = parseIcsTime(value, params); break;
      case 'STATUS': cur.status = value.toUpperCase(); break;
      case 'TRANSP': cur.transp = value.toUpperCase(); break;
      default: break;
    }
  }
  // RECURRENCE-ID のある回(変更・取り消し)は、元の繰り返しからその回を外す
  const byUid = {};
  for (const ev of events) if (ev.rec && ev.uid) byUid[ev.uid] = ev;
  const kept = [];
  for (const ev of events) {
    if (ev.recurId != null && ev.uid && byUid[ev.uid]) {
      (byUid[ev.uid].exdates || (byUid[ev.uid].exdates = [])).push(ev.recurId);
    }
    if (!ev.cancelled) kept.push(ev);
  }
  return { calendars: [{ id: calId, name: name || fallbackName || 'ICSカレンダー', source: 'ファイル' }], events: kept };
}

// ---- 空き時間 ----
// 設定: { weekday: {start,end}, weekend: {start,end}, minFree(分), buffer(分), allDayBusy }
function dayWindow(day, settings) {
  const wd = new Date(day).getDay();
  const w = (wd === 0 || wd === 6) ? settings.weekend : settings.weekday;
  const s = day + hm(w.start) * MIN;
  let e = day + hm(w.end) * MIN;
  if (e <= s) e = day + DAY; // 終わりが 0:00 など開始より前 → 24時まで
  return { s, e };
}

function mergeIntervals(list) {
  const xs = list.filter((x) => x.e > x.s).sort((a, b) => a.s - b.s);
  const out = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e);
    else out.push({ s: x.s, e: x.e });
  }
  return out;
}

// occurrences: その日に重なる回(expandEvent の結果)。now より前は空きにしない
function freeSlots(day, occurrences, settings, now) {
  const win = dayWindow(day, settings);
  const buf = (settings.buffer || 0) * MIN;
  const busy = [];
  for (const o of occurrences) {
    if (o.ev.allDay) {
      if (settings.allDayBusy) busy.push({ s: win.s, e: win.e });
    } else {
      busy.push({ s: o.s - buf, e: o.e + buf });
    }
  }
  // その日の最初の授業から最後の授業までは学校にいる時間 → 授業の間の空きコマは空き時間に数えない
  const span = classSpan(occurrences);
  if (span && !settings.komaFree) busy.push(span);
  if (now != null && now > win.s) busy.push({ s: win.s, e: Math.min(now, win.e) });
  const merged = mergeIntervals(busy.map((b) => ({ s: Math.max(b.s, win.s), e: Math.min(b.e, win.e) })));
  const free = [];
  let cur = win.s;
  for (const b of merged) {
    if (b.s > cur) free.push({ s: cur, e: b.s });
    cur = Math.max(cur, b.e);
  }
  if (cur < win.e) free.push({ s: cur, e: win.e });
  const min = (settings.minFree || 0) * MIN;
  return free.filter((f) => f.e - f.s >= Math.max(min, MIN));
}

// その日の授業(manaba)の最初の開始〜最後の終わり。授業がなければ null
function classSpan(occurrences) {
  const cls = occurrences.filter((o) => o.ev.cal === CLASS_CAL && !o.ev.allDay);
  if (!cls.length) return null;
  return { s: Math.min(...cls.map((o) => o.s)), e: Math.max(...cls.map((o) => o.e)) };
}

// 授業と授業の間の、予定の入っていない時間(空きコマ)。休み時間(10分など)のような短いすき間は除く
const KOMA_MIN = 40;
function komaSlots(occurrences) {
  const span = classSpan(occurrences);
  if (!span) return [];
  const busy = mergeIntervals(occurrences.filter((o) => !o.ev.allDay).map((o) => ({ s: Math.max(o.s, span.s), e: Math.min(o.e, span.e) })));
  const out = [];
  let cur = span.s;
  for (const b of busy) {
    if (b.s > cur) out.push({ s: cur, e: b.s });
    cur = Math.max(cur, b.e);
  }
  return out.filter((k) => k.e - k.s >= KOMA_MIN * MIN);
}

// ---- バイトのシフト希望 ----
// 営業時間(windows)のうち、空いていて min 分以上入れる時間。開始は30分単位で切り上げ、終わりは切り捨て。
// 閉店(その日の最後の営業時間の終わり)まで入れるときは last: true(文章では「ラスト」)
const SHIFT_DEFAULT = { windows: [['11:00', '14:00'], ['16:00', '22:30']], min: 180 };
function shiftBlocks(day, occurrences, settings, shift = SHIFT_DEFAULT) {
  const all = { ...settings, weekday: { start: '00:00', end: '00:00' }, weekend: { start: '00:00', end: '00:00' }, minFree: 0 };
  const free = freeSlots(day, occurrences, all, null);
  const step = 30 * MIN;
  const closing = day + hm(shift.windows[shift.windows.length - 1][1]) * MIN;
  const out = [];
  for (const [ws, we] of shift.windows) {
    const a = day + hm(ws) * MIN;
    const b = day + hm(we) * MIN;
    for (const f of free) {
      let s = Math.max(f.s, a);
      let e = Math.min(f.e, b);
      if (e <= s) continue;
      if (s !== a) s = day + Math.ceil((s - day) / step) * step;
      if (e !== b) e = day + Math.floor((e - day) / step) * step;
      if (e - s >= shift.min * MIN) out.push({ s, e, last: e === closing });
    }
  }
  return out;
}

// 「11月2日19時30分-ラスト」のような1行
function shiftJa(t) {
  const d = new Date(t);
  return `${d.getHours()}時${d.getMinutes() ? `${d.getMinutes()}分` : ''}`;
}
function shiftLine(b) {
  const d = new Date(b.s);
  return `${d.getMonth() + 1}月${d.getDate()}日${shiftJa(b.s)}-${b.last ? 'ラスト' : shiftJa(b.e)}`;
}
function shiftText(blocks) {
  return ['お疲れ様です！', '希望シフト以下の通りでよろしくお願いします。', '', ...blocks.map(shiftLine), '', 'よろしくお願いします！'].join('\n');
}

// シフトを出す週: 次の週の月曜(水曜に提出する分)
function nextWeekMonday(t) {
  const d = new Date(startOfDay(t));
  return addDays(d.getTime(), 7 - ((d.getDay() + 6) % 7));
}

if (typeof module !== 'undefined') {
  module.exports = { CLASS_CAL, normalizeClasses, DAY, MIN, startOfDay, addDays, dayKey, parseDayKey, hm, zonedToMs, localMidnightOf, parseIcsTime, parseRRule, expandEvent, normalizeTimeTree, parseIcs, dayWindow, mergeIntervals, freeSlots, classSpan, komaSlots, SHIFT_DEFAULT, shiftBlocks, shiftLine, shiftText, nextWeekMonday };
}
