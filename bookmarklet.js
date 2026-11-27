/*
 * manaba 未提出課題一覧 / コース一覧(曜日表示) → PWA 取り込み用ブックマークレット本体。
 * bookmarklet.html がこのファイルを読み込み、__APP_URL__ を置き換えて
 * javascript: URL に変換する。(ここを編集したら bookmarklet.html から登録し直す)
 */
(function () {
  var APP_URL = '__APP_URL__';
  // 短いコード(このファイルを読み込む形)で実行されたときは、読み込み元からアプリのURLを求める
  if (APP_URL.indexOf('http') !== 0 && document.currentScript && document.currentScript.src) {
    APP_URL = document.currentScript.src.replace(/bookmarklet\.js.*$/, '');
  }
  var ID = 'manaba-pwa-overlay';

  var old = document.getElementById(ID);
  if (old) old.remove();

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  // 見出しに「受付終了」と「タイトル」を含む表を探す
  function findTable() {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var rows = tables[i].querySelectorAll('tr');
      for (var r = 0; r < rows.length && r < 3; r++) {
        var cells = rows[r].querySelectorAll('th,td');
        var texts = [];
        for (var c = 0; c < cells.length; c++) texts.push(clean(cells[c].textContent));
        var joined = texts.join('|');
        if (joined.indexOf('受付終了') >= 0 && joined.indexOf('タイトル') >= 0) {
          return { table: tables[i], headerRow: r, headers: texts };
        }
      }
    }
    return null;
  }

  function idx(headers, word) {
    for (var i = 0; i < headers.length; i++) if (headers[i].indexOf(word) >= 0) return i;
    return -1;
  }

  // ---- 未提出課題一覧 ----
  function readTasks(found) {
    var h = found.headers;
    var col = {
      type: idx(h, 'タイプ'),
      title: idx(h, 'タイトル'),
      course: idx(h, 'コース'),
      start: idx(h, '受付開始'),
      end: idx(h, '受付終了')
    };
    var items = [];
    var skipped = 0;
    var rows = found.table.querySelectorAll('tr');
    for (var r = found.headerRow + 1; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('td,th');
      if (cells.length <= Math.max(col.title, col.end)) continue;
      var get = function (i) { return i >= 0 && cells[i] ? clean(cells[i].textContent) : ''; };
      var end = get(col.end);
      var title = get(col.title);
      if (!title) continue;
      if (!end) { skipped++; continue; }
      var a = cells[col.title].querySelector('a[href]');
      items.push({
        type: get(col.type),
        title: a ? clean(a.textContent) || title : title,
        course: get(col.course),
        start: get(col.start),
        end: end,
        url: a ? a.href : ''
      });
    }
    return {
      data: { app: 'manaba-pwa', v: 1, kind: 'tasks', at: new Date().toISOString(), items: items, skipped: skipped },
      message: items.length + '件の課題を読み取りました' + (skipped ? '(締切なし ' + skipped + '件は除外)' : '')
    };
  }

  // ---- コース一覧(曜日表示) ----
  var DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

  // 見出し行に「月」「火」…が並ぶ表を探す
  function findTimetable() {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var rows = tables[i].querySelectorAll('tr');
      if (!rows.length) continue;
      var cells = rows[0].querySelectorAll('th,td');
      var dayCols = {};
      var n = 0;
      for (var c = 0; c < cells.length; c++) {
        var d = DAY_NAMES.indexOf(clean(cells[c].textContent));
        if (d > 0) { dayCols[c] = d; n++; }
      }
      if (n >= 5) return { table: tables[i], dayCols: dayCols };
    }
    return null;
  }

  function readTimetable(found) {
    var slots = [];
    var count = 0;
    var rows = found.table.querySelectorAll('tr');
    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('th,td');
      if (!cells.length) continue;
      var period = parseInt(clean(cells[0].textContent), 10);
      if (!(period >= 1 && period <= 9)) continue; // 「他」の行などは飛ばす
      for (var c = 1; c < cells.length; c++) {
        var day = found.dayCols[c];
        if (!day) continue;
        // コース本体へのリンク(…/course_1234567)だけを拾う。アイコンのリンクは除外
        var links = cells[c].querySelectorAll('a[href]');
        var courses = [];
        var seen = {};
        for (var k = 0; k < links.length; k++) {
          var href = links[k].href;
          var name = clean(links[k].textContent).replace(/※リンク中/g, '').trim();
          if (!name || !/course_\d+\/?(\?.*)?$/.test(href) || seen[href]) continue;
          seen[href] = true;
          courses.push({ name: name, url: href });
        }
        if (courses.length) {
          slots.push({ day: day, period: period, courses: courses });
          count += courses.length;
        }
      }
    }
    return {
      data: { app: 'manaba-pwa', v: 1, kind: 'timetable', at: new Date().toISOString(), slots: slots },
      message: '時間割を読み取りました(' + slots.length + 'コマ・授業' + count + '件)'
    };
  }

  // ---- Bナビ: MYスケジュール(選んだ日の「1限: 授業名 @教室」)----
  // 1回に1日分しか出ないので、読んだ曜日をこのサイトの localStorage に貯めて、まとめてコピーする
  var ROOMS_KEY = 'manaba-pwa-rooms';

  function pageLines() {
    var texts = [document.body ? document.body.innerText : ''];
    for (var i = 0; i < window.frames.length; i++) {
      try { texts.push(window.frames[i].document.body.innerText); } catch (e) { /* 別サイトの枠は読めない */ }
    }
    return texts.join('\n').split(/\n+/).map(clean);
  }

  function readRoomsOfPage() {
    var lines = pageLines();
    var date = null;
    var days = {};
    for (var i = 0; i < lines.length; i++) {
      var d = lines[i].match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (d) { date = d[1] + '-' + ('0' + d[2]).slice(-2) + '-' + ('0' + d[3]).slice(-2); continue; }
      var m = lines[i].match(/^(\d)\s*限\s*[:：]\s*(.+?)\s*[@＠]\s*(.+)$/);
      if (m && date) {
        if (!days[date]) days[date] = [];
        days[date].push({ period: Number(m[1]), name: m[2], room: m[3] });
      }
    }
    return days;
  }

  function readRooms(found) {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(ROOMS_KEY) || '{}'); } catch (e) { saved = {}; }
    // 曜日ごとに最新の日だけ残す
    for (var ds in found) {
      var wd = new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10))).getDay();
      saved[wd] = { date: ds, entries: found[ds] };
    }
    try { localStorage.setItem(ROOMS_KEY, JSON.stringify(saved)); } catch (e) { /* 保存できなくても今回分は渡す */ }
    var days = [];
    var names = [];
    for (var w = 1; w <= 6; w++) {
      if (saved[w]) { days.push(saved[w]); names.push(DAY_NAMES[w]); }
    }
    return {
      data: { app: 'manaba-pwa', v: 1, kind: 'rooms', at: new Date().toISOString(), days: days },
      message: '教室を読み取りました(' + names.join('・') + '曜)',
      note: '授業がある曜日の日付をカレンダーで押して、そのたびに「manaba取込」を押すと、曜日がたまっていきます。全部そろったら「コピー」してください。',
      reset: true
    };
  }

  // ---- manaba の課題ページ(1つの課題の説明)----
  // 「課題内容」「説明」などの行を読む。読めないときは、選んだ(長押しで選択した)文字を使う
  function isTaskPage() {
    return /course_\d+_[a-z]+_\d+/.test(location.pathname);
  }

  // 見出しで見つからないとき: メニュー・ヘッダー・日時の表などを除いて、一番長い文章のまとまりを探す
  function longestBlock() {
    var skip = /^(nav|header|footer|script|style|noscript|form|select|button)$/i;
    var skipClass = /(nav|menu|header|footer|breadcrumb|sidebar|tab|pager|login|copyright)/i;
    var best = null;
    var bestLen = 0;
    var nodes = document.body.querySelectorAll('div, td, section, article, p, li, dd');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var bad = false;
      for (var p = n; p && p !== document.body; p = p.parentElement) {
        if (skip.test(p.tagName) || skipClass.test(String(p.className || '') + ' ' + (p.id || ''))) { bad = true; break; }
      }
      if (bad || n.id === ID) continue;
      var text = String(n.innerText || '').trim();
      // 大きすぎる入れ物(ページ全体など)より、文章そのものに近い要素を選ぶ: 子に同じくらい長い要素があれば飛ばす
      var len = text.length;
      if (len < 20) continue;
      var kids = n.children;
      var covered = false;
      for (var k = 0; k < kids.length; k++) {
        if (String(kids[k].innerText || '').trim().length > len * 0.8) { covered = true; break; }
      }
      if (covered) continue;
      // 日時や数字ばかりの表は除く
      var datey = (text.match(/\d{4}-\d{2}-\d{2}/g) || []).length;
      if (datey >= 2 && len < 200) continue;
      if (len > bestLen) { best = text; bestLen = len; }
    }
    return best ? best.replace(/\n{3,}/g, '\n\n') : '';
  }

  function readTaskDesc() {
    var sel = clean(window.getSelection ? String(window.getSelection()) : '');
    var rows = document.querySelectorAll('tr');
    var title = '';
    var end = '';
    var exact = [];  // 見出しが「問題」「課題内容」などぴったりの行
    var parts = [];  // 見出しにそれらしい言葉を含む行
    for (var i = 0; i < rows.length; i++) {
      // 見出しは th のことも td のこともある(manaba のレポート提出窓口は td)。左のマスを見出し、右のマスを中身とみなす
      var cells = rows[i].querySelectorAll('th, td');
      if (cells.length < 2) continue;
      var label = clean(cells[0].textContent);
      var cell = cells[cells.length - 1];
      var text = String(cell.innerText || cell.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
      if (!text || label.length > 20) continue;
      if (label.indexOf('タイトル') >= 0) title = clean(text);
      else if (label.indexOf('受付終了') >= 0) end = clean(text.split('\n')[0]);
      else if (/^(問題|課題内容|課題|説明|内容|本文|課題文|指示|設問)$/.test(label)) exact.push(text);
      else if (/課題内容|説明|内容|指示|問題|本文|詳細|概要|課題文/.test(label)) parts.push(text);
    }
    if (!title) {
      // 表の一番上の1マスだけの行(「課題５ 教授フローチャート」など)を題名にする
      for (var j = 0; j < rows.length; j++) {
        var only = rows[j].querySelectorAll('th, td');
        if (only.length === 1 && clean(only[0].textContent).length <= 60) { title = clean(only[0].textContent); break; }
      }
    }
    if (exact.length) parts = exact;
    var desc = sel || parts.join('\n\n') || longestBlock();
    if (!desc) return null;
    if (!title) {
      var h = document.querySelector('h1, h2, .pagetitle, .articletitle');
      title = h ? clean(h.textContent) : clean(document.title);
    }
    return {
      data: { app: 'manaba-pwa', v: 1, kind: 'taskdesc', at: new Date().toISOString(), url: location.href.split('#')[0], title: title, end: end, desc: desc },
      message: (sel ? '選んだ部分を読み取りました' : '課題の説明を読み取りました') + '(' + desc.length + '文字)',
      note: '説明がうまく読めていないときは、説明文を長押しで選んでから、もう一度「manaba取込」を押してください。'
    };
  }

  var result;
  if (isTaskPage() || clean(window.getSelection ? String(window.getSelection()) : '')) {
    result = readTaskDesc();
    if (!result) {
      alert('課題の説明が見つかりませんでした。\n説明文を長押しで選んでから、もう一度「manaba取込」を押してください。');
      return;
    }
  }
  var taskTable = result ? null : findTable();
  var ttTable = taskTable || result ? null : findTimetable();
  var roomDays = taskTable || ttTable || result ? null : readRoomsOfPage();
  if (result) { /* 課題ページ */ }
  else if (taskTable) result = readTasks(taskTable);
  else if (ttTable) result = readTimetable(ttTable);
  else if (roomDays && Object.keys(roomDays).length) result = readRooms(roomDays);
  else {
    alert('読み取れる表が見つかりませんでした。\nmanabaの「未提出課題一覧」、「コース」の「曜日」表示、またはBナビの「MYスケジュール」で授業のある日を選んだ状態で実行してください。');
    return;
  }
  var json = JSON.stringify(result.data);

  // ---- 結果表示 ----
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
  msg.textContent = result.message;
  box.appendChild(msg);

  var sub = document.createElement('div');
  sub.style.cssText = 'font-size:13px;color:#555;margin:4px 0 12px';
  sub.textContent = (result.note ? result.note + ' ' : '') + '「コピー」を押してから、アプリに戻って「② 取り込む」を押してください。';
  box.appendChild(sub);

  function btn(label, primary) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;padding:12px;margin-top:8px;border-radius:10px;font-size:16px;' +
      (primary ? 'background:#1f6feb;color:#fff;border:none;font-weight:700' : 'background:#f2f2f2;color:#111;border:1px solid #ddd');
    box.appendChild(b);
    return b;
  }

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
    function fail() {
      if (fallbackCopy()) done();
      else copyBtn.textContent = '下の文字を全選択してコピーしてください';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(done, fail);
    } else {
      fail();
    }
  };

  if (APP_URL.indexOf('http') === 0) {
    var link = document.createElement('a');
    link.href = APP_URL + '#import=' + encodeURIComponent(json);
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Safariでアプリを開いて取り込む(ホーム画面アプリでは使えません)';
    link.style.cssText = 'display:block;margin-top:12px;font-size:13px;color:#1f6feb';
    box.appendChild(link);
  }

  if (result.reset) {
    btn('ためた曜日を消して最初から', false).onclick = function () {
      try { localStorage.removeItem(ROOMS_KEY); } catch (e) { /* ignore */ }
      box.remove();
    };
  }
  btn('閉じる', false).onclick = function () { box.remove(); };

  document.body.appendChild(box);
})();
