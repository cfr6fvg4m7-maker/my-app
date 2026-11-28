/*
 * TimeTree(Web版 timetreeapp.com)⇄ 空き時間アプリ 用ブックマークレット本体。
 * aki/bookmarklet.html がこのファイルを読み込み、__APP_URL__ を置き換えて javascript: URL に変換する。
 * (ここを編集したら bookmarklet.html から登録し直す)
 *
 * できること
 *  1. 予定を読み取る: TimeTree の予定をコピーして、空き時間アプリに渡す
 *  2. 予定を追加する: 空き時間アプリでコピーした予定(kind: aki-add)を TimeTree に書き込む
 *
 * TimeTree の公式APIは2023年12月に終了したため、ログイン中のWeb版が使っているURLを同じページから呼ぶ。
 *   読み取り: GET  /api/v1/calendars?since=0, /api/v1/calendar/{id}/events/sync
 *   追加:     POST /api/v1/calendar/{id}/event(ページの <meta name="csrf-token"> を X-CSRF-Token に付ける)
 * パスワードは扱わない。追加は、画面で内容を確かめて「追加する」を押したときだけ行う。
 */
(function () {
  var APP_URL = '__APP_URL__';
  var ID = 'aki-timetree-overlay';
  var HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Timetreea': 'web/2.1.0/ja' };

  var old = document.getElementById(ID);
  if (old) old.remove();

  // ---- 表示 ----
  var box = document.createElement('div');
  box.id = ID;
  box.setAttribute('style', [
    'position:fixed', 'left:12px', 'right:12px', 'top:12px', 'z-index:2147483647',
    'background:#fff', 'color:#111', 'border-radius:14px', 'padding:16px',
    'box-shadow:0 8px 30px rgba(0,0,0,.35)', 'font:15px/1.5 -apple-system,sans-serif',
    'max-width:480px', 'margin:0 auto', 'max-height:85vh', 'overflow-y:auto'
  ].join(';'));
  var msg = document.createElement('div');
  msg.style.fontWeight = '700';
  box.appendChild(msg);
  var sub = document.createElement('div');
  sub.style.cssText = 'font-size:13px;color:#555;margin:4px 0 12px;white-space:pre-line';
  box.appendChild(sub);
  var area = document.createElement('div');
  box.appendChild(area);
  document.body.appendChild(box);

  function clear() { area.innerHTML = ''; }
  function btn(label, primary) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;padding:12px;margin-top:8px;border-radius:10px;font-size:16px;' +
      (primary ? 'background:#1f9d55;color:#fff;border:none;font-weight:700' : 'background:#f2f2f2;color:#111;border:1px solid #ddd');
    area.appendChild(b);
    return b;
  }
  function closeBtn() { btn('閉じる', false).onclick = function () { box.remove(); }; }
  function fail(text) {
    clear();
    msg.textContent = 'うまくいきませんでした';
    sub.textContent = text;
    closeBtn();
  }

  if (!/timetreeapp\.com$/.test(location.hostname) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    msg.textContent = 'TimeTreeのページで使ってください';
    sub.textContent = 'TimeTreeのWeb版(timetreeapp.com)にログインしたページで実行してください。';
    var a = document.createElement('a');
    a.href = 'https://timetreeapp.com/calendars';
    a.textContent = 'TimeTreeを開く';
    a.style.cssText = 'display:block;margin-top:8px;color:#1f9d55;font-weight:700';
    area.appendChild(a);
    closeBtn();
    return;
  }

  function request(method, path, body, headers) {
    var opt = { method: method, credentials: 'include', headers: headers || HEADERS };
    if (body) opt.body = JSON.stringify(body);
    return fetch(path, opt).then(function (r) {
      if (r.status === 401) throw new Error('login');
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : {}; } catch (e) { j = null; }
        if (!r.ok) {
          var err = new Error('HTTP ' + r.status + (t ? ' ' + t.slice(0, 120) : ''));
          err.status = r.status;
          throw err;
        }
        return j || {};
      });
    });
  }
  function getJson(path) { return request('GET', path); }

  // events/sync は chunk が true の間、since を付けて続きを読む
  function getEvents(calId, since, acc, guard) {
    var path = '/api/v1/calendar/' + calId + '/events/sync' + (since ? '?since=' + since : '');
    return getJson(path).then(function (j) {
      acc = acc.concat(j.events || []);
      if (j.chunk === true && j.since && guard < 200) return getEvents(calId, j.since, acc, guard + 1);
      return acc;
    });
  }

  function getCalendars() {
    return getJson('/api/v1/calendars?since=0').then(function (j) {
      var cals = (j.calendars || []).filter(function (c) { return !c.deactivated_at; });
      if (!cals.length) throw new Error('nocal');
      return cals;
    });
  }

  function loginMessage(e) {
    if (e && e.message === 'login') return 'TimeTreeにログインしていないようです。ログインしてから、もう一度実行してください。';
    if (e && e.message === 'nocal') return 'カレンダーが見つかりませんでした。';
    return 'TimeTreeの仕組みが変わった可能性があります。(' + (e && e.message ? e.message : e) + ')';
  }

  // ---- 1. 予定を読み取る ----
  var now = Date.now();
  var PAST = now - 2 * 86400000; // 終わってから2日以上たった単発の予定は送らない
  var FUTURE = now + 400 * 86400000;

  function slim(ev, calId) {
    var rec = (ev.recurrences || []).filter(function (x) { return x; });
    return {
      id: String(ev.uuid || ev.id),
      cal: String(calId),
      title: ev.title || '',
      allDay: !!ev.all_day,
      s: ev.start_at,
      e: ev.end_at,
      stz: ev.start_timezone || 'UTC',
      etz: ev.end_timezone || ev.start_timezone || 'UTC',
      rec: rec.length ? rec : undefined,
      parent: ev.recurring_uuid || ev.parent_id || undefined,
    };
  }

  function keep(ev) {
    if (ev.deactivated_at) return false; // 削除済み
    if (ev.type === 1) return false; // 誕生日
    if (ev.category === 2) return false; // メモ(日時のないもの)
    if (typeof ev.start_at !== 'number' || typeof ev.end_at !== 'number') return false;
    if (ev.recurrences && ev.recurrences.length) return true;
    return ev.end_at >= PAST && ev.start_at <= FUTURE;
  }

  function readAll(prefix) {
    clear();
    msg.textContent = 'TimeTreeの予定を読み込み中…';
    sub.textContent = '';
    return getCalendars().then(function (cals) {
      var out = { kind: 'aki-timetree', v: 1, at: now, calendars: [], events: [] };
      var chain = Promise.resolve();
      cals.forEach(function (c, i) {
        chain = chain.then(function () {
          msg.textContent = 'TimeTreeの予定を読み込み中…(' + (i + 1) + '/' + cals.length + ')';
          sub.textContent = c.name || '';
          return getEvents(c.id, 0, [], 0).then(function (evs) {
            var n = 0;
            evs.forEach(function (ev) { if (keep(ev)) { out.events.push(slim(ev, c.id)); n++; } });
            out.calendars.push({ id: String(c.id), name: c.name || 'カレンダー', alias: c.alias_code || undefined, count: n });
          });
        });
      });
      return chain.then(function () { return out; });
    }).then(function (out) {
      showCopy(out, prefix);
    }).catch(function (e) { fail(loginMessage(e)); });
  }

  function showCopy(out, prefix) {
    var json = JSON.stringify(out);
    clear();
    msg.textContent = (prefix || '') + out.calendars.length + '個のカレンダー・' + out.events.length + '件の予定を読み取りました';
    sub.textContent = '「コピー」を押してから、空き時間アプリに戻って「貼り付けて取り込む」を押してください。';

    var ta = document.createElement('textarea');
    ta.value = json;
    ta.readOnly = true;
    ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0';
    area.appendChild(ta);

    function fallbackCopy() {
      ta.style.cssText = 'display:block;width:100%;height:80px;margin-top:8px;font-size:12px';
      ta.readOnly = false;
      ta.focus();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.readOnly = true;
      return ok;
    }

    var copyBtn = btn('コピー', true);
    copyBtn.onclick = function () {
      function done() { copyBtn.textContent = 'コピーしました ✓'; }
      function ng() {
        if (fallbackCopy()) done();
        else copyBtn.textContent = '下の文字を全選択してコピーしてください';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, ng);
      else ng();
    };

    if (APP_URL.indexOf('http') === 0 && json.length < 60000) {
      var link = document.createElement('a');
      link.href = APP_URL + '#import=' + encodeURIComponent(json);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Safariでアプリを開いて取り込む(ホーム画面アプリでは使えません)';
      link.style.cssText = 'display:block;margin-top:12px;font-size:13px;color:#1f9d55';
      area.appendChild(link);
    }
    closeBtn();
  }

  // ---- 2. 予定を追加する ----
  function fmt(ms, allDay) {
    var d = new Date(ms);
    var md = (d.getMonth() + 1) + '/' + d.getDate() + '(' + '日月火水木金土'[d.getDay()] + ')';
    if (allDay) return md + ' 終日';
    return md + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function hmOf(ms) { var d = new Date(ms); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }

  function parseAdd(text) {
    var data = null;
    try { data = JSON.parse(String(text || '').trim()); } catch (e) { data = null; }
    if (!data || data.kind !== 'aki-add' || !data.items || !data.items.length) return null;
    return data.items.filter(function (x) { return x && x.cal && x.title && typeof x.s === 'number' && typeof x.e === 'number'; });
  }

  // CSRFトークン: 今のページの <meta>。なければカレンダーの予定作成ページから読む
  function csrfToken(alias) {
    var m = document.querySelector('meta[name="csrf-token"]');
    if (m && m.content) return Promise.resolve(m.content);
    if (!alias) return Promise.resolve('');
    return fetch('/calendars/' + alias + '/events/new', { credentials: 'include' }).then(function (r) { return r.text(); }).then(function (html) {
      var x = html.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/) || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']csrf-token["']/);
      return x ? x[1] : '';
    }).catch(function () { return ''; });
  }

  function payload(x, userId) {
    var tz = x.allDay ? 'UTC' : (x.tz || 'Asia/Tokyo');
    var s = x.s; var e = x.e;
    if (x.allDay) {
      // TimeTree の終日は「UTCの0時」で、終わりは最終日(含む)
      var sd = new Date(x.s); var ed = new Date(x.e - 1);
      s = Date.UTC(sd.getFullYear(), sd.getMonth(), sd.getDate());
      e = Math.max(s, Date.UTC(ed.getFullYear(), ed.getMonth(), ed.getDate()));
    }
    return {
      title: x.title, all_day: !!x.allDay, start_at: s, start_timezone: tz, end_at: e, end_timezone: tz,
      category: 1, type: 0, label_id: 1, attendees: userId ? [userId] : [], alerts: [], recurrences: [],
      location: '', location_lat: null, location_lon: null, url: null, note: x.note || null,
      attachment: { virtual_user_attendees: [] }, files: [],
    };
  }

  function addFlow(items) {
    clear();
    msg.textContent = 'TimeTreeに予定を追加します';
    sub.textContent = '内容を確かめて「追加する」を押してください。';
    getCalendars().then(function (cals) {
      var byId = {};
      cals.forEach(function (c) { byId[String(c.id)] = c; });
      var list = document.createElement('ul');
      list.style.cssText = 'margin:0 0 4px;padding-left:20px';
      items.forEach(function (x) {
        var li = document.createElement('li');
        var c = byId[String(x.cal)];
        li.textContent = x.title + ' ・ ' + fmt(x.s, x.allDay) + (x.allDay ? '' : '〜' + hmOf(x.e)) + ' ・ ' + (c ? c.name : '(カレンダーが見つかりません)');
        list.appendChild(li);
      });
      area.appendChild(list);
      var go = btn('追加する(' + items.length + '件)', true);
      btn('やめる', false).onclick = function () { box.remove(); };
      go.onclick = function () {
        go.disabled = true;
        go.textContent = '追加中…';
        var added = 0; var skipped = 0; var errors = [];
        getJson('/api/v1/user').then(function (u) {
          var userId = (u.user || u).id;
          var chain = Promise.resolve();
          items.forEach(function (x) {
            var c = byId[String(x.cal)];
            chain = chain.then(function () {
              if (!c) { errors.push(x.title + ': カレンダーが見つかりません'); return null; }
              // すでに同じ予定(同じ名前・同じ開始)があれば入れない(2回押したときなど)
              return getEvents(c.id, 0, [], 0).then(function (evs) {
                var p = payload(x, userId);
                var dup = evs.some(function (ev) { return !ev.deactivated_at && ev.title === p.title && ev.start_at === p.start_at; });
                if (dup) { skipped++; return null; }
                return csrfToken(c.alias_code).then(function (token) {
                  var h = {};
                  for (var k in HEADERS) h[k] = HEADERS[k];
                  if (token) h['X-CSRF-Token'] = token;
                  return request('POST', '/api/v1/calendar/' + c.id + '/event', p, h).then(function () { added++; });
                });
              }).catch(function (e) { errors.push(x.title + ': ' + (e && e.message ? e.message : e)); });
            });
          });
          return chain;
        }).then(function () {
          if (errors.length && !added && !skipped) { fail('TimeTreeに追加できませんでした。\n' + errors.join('\n')); return; }
          var head = '追加しました: ' + added + '件' + (skipped ? '(すでにあった' + skipped + '件は追加せず)' : '') + '。';
          if (errors.length) head += '\n追加できなかったもの: ' + errors.join(' / ');
          // 追加したあとの予定を読み直して、アプリに戻せるようにする
          readAll(head + '\n');
        }).catch(function (e) { fail(loginMessage(e)); });
      };
    }).catch(function (e) { fail(loginMessage(e)); });
  }

  function pasteForAdd() {
    function useText(t) {
      var items = parseAdd(t);
      if (!items || !items.length) {
        fail('追加する予定が見つかりませんでした。空き時間アプリで「TimeTreeに入れる」を押してから、もう一度実行してください。');
        return;
      }
      addFlow(items);
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(useText, function () { manualPaste(useText); });
    } else {
      manualPaste(useText);
    }
  }
  function manualPaste(useText) {
    clear();
    msg.textContent = '追加する予定を貼り付けてください';
    sub.textContent = '下の欄を長押しして「ペースト」→「次へ」。';
    var ta = document.createElement('textarea');
    ta.style.cssText = 'display:block;width:100%;height:80px;font-size:12px;box-sizing:border-box';
    area.appendChild(ta);
    btn('次へ', true).onclick = function () { useText(ta.value); };
    closeBtn();
  }

  // ---- はじめの画面 ----
  msg.textContent = 'TimeTree取込';
  sub.textContent = 'どちらをしますか?';
  btn('予定を読み取る(空き時間アプリへ)', true).onclick = function () { readAll(''); };
  btn('コピーした予定をTimeTreeに追加', false).onclick = pasteForAdd;
  closeBtn();
})();
