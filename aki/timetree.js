/*
 * TimeTree(Web版 timetreeapp.com)→ 空き時間アプリ 取り込み用ブックマークレット本体。
 * aki/bookmarklet.html がこのファイルを読み込み、__APP_URL__ を置き換えて javascript: URL に変換する。
 * (ここを編集したら bookmarklet.html から登録し直す)
 *
 * TimeTree の公式APIは2023年12月に終了したため、ログイン中のWeb版が使っている
 * 読み取り用のURL(/api/v1/calendars, /api/v1/calendar/{id}/events/sync)を同じページから呼ぶ。
 * パスワードは扱わない。読み取るだけで、TimeTreeの予定は変更しない。
 */
(function () {
  var APP_URL = '__APP_URL__';
  var ID = 'aki-timetree-overlay';
  var HEADERS = { 'Content-Type': 'application/json', 'X-Timetreea': 'web/2.1.0/ja' };

  var old = document.getElementById(ID);
  if (old) old.remove();

  // ---- 表示 ----
  var box = document.createElement('div');
  box.id = ID;
  box.setAttribute('style', [
    'position:fixed', 'left:12px', 'right:12px', 'top:12px', 'z-index:2147483647',
    'background:#fff', 'color:#111', 'border-radius:14px', 'padding:16px',
    'box-shadow:0 8px 30px rgba(0,0,0,.35)', 'font:15px/1.5 -apple-system,sans-serif',
    'max-width:480px', 'margin:0 auto'
  ].join(';'));
  var msg = document.createElement('div');
  msg.style.fontWeight = '700';
  msg.textContent = 'TimeTreeの予定を読み込み中…';
  box.appendChild(msg);
  var sub = document.createElement('div');
  sub.style.cssText = 'font-size:13px;color:#555;margin:4px 0 12px';
  box.appendChild(sub);
  document.body.appendChild(box);

  function btn(label, primary) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;padding:12px;margin-top:8px;border-radius:10px;font-size:16px;' +
      (primary ? 'background:#1f9d55;color:#fff;border:none;font-weight:700' : 'background:#f2f2f2;color:#111;border:1px solid #ddd');
    box.appendChild(b);
    return b;
  }
  function closeBtn() { btn('閉じる', false).onclick = function () { box.remove(); }; }

  function fail(text) {
    msg.textContent = '読み込めませんでした';
    sub.textContent = text;
    closeBtn();
  }

  if (!/timetreeapp\.com$/.test(location.hostname) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    fail('TimeTreeのWeb版(timetreeapp.com)にログインしたページで実行してください。');
    var a = document.createElement('a');
    a.href = 'https://timetreeapp.com/';
    a.textContent = 'TimeTreeを開く';
    a.style.cssText = 'display:block;margin-top:8px;color:#1f9d55;font-weight:700';
    box.insertBefore(a, box.lastChild);
    return;
  }

  function getJson(path) {
    return fetch(path, { credentials: 'include', headers: HEADERS }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('login');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // events/sync は chunk が true の間、since を付けて続きを読む
  function getEvents(calId, since, acc, guard) {
    var path = '/api/v1/calendar/' + calId + '/events/sync' + (since ? '?since=' + since : '');
    return getJson(path).then(function (j) {
      acc = acc.concat(j.events || []);
      if (j.chunk === true && j.since && guard < 200) return getEvents(calId, j.since, acc, guard + 1);
      return acc;
    });
  }

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

  getJson('/api/v1/calendars?since=0').then(function (j) {
    var cals = (j.calendars || []).filter(function (c) { return !c.deactivated_at; });
    if (!cals.length) throw new Error('nocal');
    var out = { kind: 'aki-timetree', v: 1, at: now, calendars: [], events: [] };
    var chain = Promise.resolve();
    cals.forEach(function (c, i) {
      chain = chain.then(function () {
        msg.textContent = 'TimeTreeの予定を読み込み中…(' + (i + 1) + '/' + cals.length + ')';
        sub.textContent = c.name || '';
        return getEvents(c.id, 0, [], 0).then(function (evs) {
          var n = 0;
          evs.forEach(function (ev) { if (keep(ev)) { out.events.push(slim(ev, c.id)); n++; } });
          out.calendars.push({ id: String(c.id), name: c.name || 'カレンダー', count: n });
        });
      });
    });
    return chain.then(function () { return out; });
  }).then(function (out) {
    var json = JSON.stringify(out);
    msg.textContent = out.calendars.length + '個のカレンダー・' + out.events.length + '件の予定を読み取りました';
    sub.textContent = '「コピー」を押してから、空き時間アプリに戻って「取り込む」を押してください。';

    var ta = document.createElement('textarea');
    ta.value = json;
    ta.readOnly = true;
    ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0';
    box.appendChild(ta);

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
      box.appendChild(link);
    }
    closeBtn();
  }).catch(function (e) {
    if (e && e.message === 'login') fail('TimeTreeにログインしていないようです。ログインしてから、もう一度実行してください。');
    else if (e && e.message === 'nocal') fail('カレンダーが見つかりませんでした。');
    else fail('TimeTreeの仕組みが変わった可能性があります。(' + (e && e.message ? e.message : e) + ')');
  });
})();
