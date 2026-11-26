/*
 * manaba 未提出課題一覧 → PWA 取り込み用ブックマークレット本体。
 * bookmarklet.html がこのファイルを読み込み、__APP_URL__ を置き換えて
 * javascript: URL に変換する。(ここを編集したら bookmarklet.html から登録し直す)
 */
(function () {
  var APP_URL = '__APP_URL__';
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

  var found = findTable();
  if (!found) {
    alert('未提出課題の表が見つかりませんでした。\nmanabaの「未提出課題一覧」ページで実行してください。');
    return;
  }

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

  var json = JSON.stringify({
    app: 'manaba-pwa',
    v: 1,
    at: new Date().toISOString(),
    items: items,
    skipped: skipped
  });

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
  msg.textContent = items.length + '件の課題を読み取りました' +
    (skipped ? '(締切なし ' + skipped + '件は除外)' : '');
  box.appendChild(msg);

  var sub = document.createElement('div');
  sub.style.cssText = 'font-size:13px;color:#555;margin:4px 0 12px';
  sub.textContent = '「コピー」を押してから、アプリの「manabaから取り込む」→「貼り付け」をしてください。';
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

  btn('閉じる', false).onclick = function () { box.remove(); };

  document.body.appendChild(box);
})();
