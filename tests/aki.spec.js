// 空き時間アプリ(aki/): TimeTree取込ブックマークレット・取り込み・空き時間の表示
const { test, expect } = require('@playwright/test');

function at(y, m, d, h = 0, mi = 0) { return new Date(y, m - 1, d, h, mi).getTime(); }
const NOW = at(2026, 11, 27, 10, 0); // 金曜 10:00

// TimeTree のAPIの返事(必要な項目だけ)
function ttEvent(o) {
  return { uuid: o.uuid, title: o.title, all_day: !!o.allDay, start_at: o.s, end_at: o.e, start_timezone: o.tz || 'Asia/Tokyo', end_timezone: o.tz || 'Asia/Tokyo', recurrences: o.rec || null, type: o.type || 0, category: o.category || 1, deactivated_at: o.deleted ? 1 : null };
}

async function mockTimeTree(page) {
  await page.route('**/api/v1/calendars?since=0', (r) => r.fulfill({ json: { calendars: [
    { id: 11, name: '自分用カレンダー', deactivated_at: null },
    { id: 22, name: '家族', deactivated_at: null },
    { id: 33, name: '古いカレンダー', deactivated_at: 123 },
  ] } }));
  await page.route('**/api/v1/calendar/11/events/sync', (r) => r.fulfill({ json: { chunk: true, since: 555, events: [
    ttEvent({ uuid: 'a', title: 'バイト', s: at(2026, 11, 27, 13), e: at(2026, 11, 27, 17) }),
    ttEvent({ uuid: 'old', title: '去年の予定', s: at(2025, 11, 1, 13), e: at(2025, 11, 1, 14) }),
    ttEvent({ uuid: 'bd', title: '誕生日', s: Date.UTC(2026, 10, 28), e: Date.UTC(2026, 10, 28), allDay: true, tz: 'UTC', type: 1 }),
  ] } }));
  await page.route('**/api/v1/calendar/11/events/sync?since=555', (r) => r.fulfill({ json: { chunk: false, since: 556, events: [
    ttEvent({ uuid: 'w', title: 'ゼミ', s: at(2026, 4, 13, 9), e: at(2026, 4, 13, 10, 30), rec: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] }),
    ttEvent({ uuid: 'del', title: '消した予定', s: at(2026, 11, 28, 10), e: at(2026, 11, 28, 11), deleted: true }),
  ] } }));
  await page.route('**/api/v1/calendar/22/events/sync', (r) => r.fulfill({ json: { chunk: false, events: [
    ttEvent({ uuid: 'f', title: '家族で外食', s: at(2026, 11, 28, 18), e: at(2026, 11, 28, 20) }),
    ttEvent({ uuid: 'trip', title: '旅行', s: Date.UTC(2026, 11, 5), e: Date.UTC(2026, 11, 6), allDay: true, tz: 'UTC' }),
  ] } }));
}

async function runBookmarklet(page) {
  await page.goto('/aki/bookmarklet.html');
  await page.waitForFunction(() => document.getElementById('code').value.startsWith('javascript:'));
  const code = await page.$eval('#code', (e) => e.value);
  await mockTimeTree(page);
  await page.goto('/tests/fixtures/timetree.html');
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  await page.locator('#aki-timetree-overlay button', { hasText: '予定を読み取る' }).click();
  await expect(page.locator('#aki-timetree-overlay')).toContainText('読み取りました');
  return {
    message: await page.$eval('#aki-timetree-overlay div', (e) => e.textContent),
    json: await page.$eval('#aki-timetree-overlay textarea', (e) => e.value),
  };
}

async function openApp(page, { stored, time = NOW } = {}) {
  await page.clock.install({ time });
  await page.goto('/aki/index.html');
  await page.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem('akiJikan', JSON.stringify(s)); }, stored);
  await page.reload();
  await page.waitForSelector('.topbar');
}

async function importJson(page, json) {
  await page.click('#btn-import');
  await page.locator('#sheet details summary').click();
  await page.fill('#paste-area', json);
  await page.click('#paste-area-import');
}

test('ブックマークレット: 続き(chunk)も読み、削除済み・誕生日・古い予定・使っていないカレンダーは除く', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { message, json } = await runBookmarklet(page);
  expect(message).toContain('2個のカレンダー・4件の予定');
  const data = JSON.parse(json);
  expect(data.kind).toBe('aki-timetree');
  expect(data.calendars.map((c) => c.name)).toEqual(['自分用カレンダー', '家族']);
  expect(data.events.map((e) => e.title).sort()).toEqual(['ゼミ', 'バイト', '家族で外食', '旅行'].sort());
  expect(data.events.find((e) => e.title === 'ゼミ').rec).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);
});

test('ブックマークレット: TimeTree以外のページでは案内を出す', async ({ page }) => {
  await page.goto('/aki/bookmarklet.html');
  await page.waitForFunction(() => document.getElementById('code').value.startsWith('javascript:'));
  const code = await page.$eval('#code', (e) => e.value);
  await page.route('http://example.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body>x</body></html>' }));
  await page.goto('http://example.test/');
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  await expect(page.locator('#aki-timetree-overlay')).toContainText('timetreeapp.com');
});

test('ブックマークレット: ログインしていないとき', async ({ page }) => {
  await page.goto('/aki/bookmarklet.html');
  await page.waitForFunction(() => document.getElementById('code').value.startsWith('javascript:'));
  const code = await page.$eval('#code', (e) => e.value);
  await page.route('**/api/v1/calendars?since=0', (r) => r.fulfill({ status: 401, body: '' }));
  await page.goto('/tests/fixtures/timetree.html');
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  await page.locator('#aki-timetree-overlay button', { hasText: '予定を読み取る' }).click();
  await expect(page.locator('#aki-timetree-overlay')).toContainText('ログインしていない');
});

test('取り込むと週・リストに空き時間が出る。カレンダーを外すとその予定は数えない', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await expect(page.locator('#empty')).toBeVisible();
  await importJson(page, json);
  await expect(page.locator('#toast')).toContainText('取り込みました(2カレンダー・4件)');
  await expect(page.locator('#empty')).toBeHidden();

  // 今日(金): 10:00〜13:00 と 17:00〜23:00 が空き → 合計9時間
  await expect(page.locator('#summary')).toContainText('あと 9時間');
  await expect(page.locator('#summary')).toContainText('いま空いています(13:00まで)');

  // 週(今日から7日): 月曜(11/30)の「ゼミ」(毎週月曜のくり返し)と、今日の「バイト」
  await expect(page.locator('#panel-week .busy', { hasText: 'ゼミ' })).toHaveCount(1);
  await expect(page.locator('#panel-week .busy', { hasText: 'バイト' })).toHaveCount(1);
  await expect(page.locator('#panel-week .free')).not.toHaveCount(0);

  // リスト: 土曜は 9:00〜18:00 と 20:00〜23:00
  await page.click('.seg [data-view="list"]');
  const sat = page.locator('#panel-list .dlist li', { hasText: '11/28(土)' });
  await expect(sat).toContainText('9:00 〜 18:00');
  await expect(sat).toContainText('20:00 〜 23:00');
  // 12/5(土) は家族の「旅行」(終日)。初期設定では終日の予定は数えない
  const trip = page.locator('#panel-list .dlist li', { hasText: '12/5(土)' });
  await expect(trip).toContainText('9:00 〜 23:00');
  await page.click('#btn-settings');
  await page.locator('[data-set="allDayBusy"]').check();
  await page.click('[data-close]');
  await expect(trip).toContainText('空きなし');

  // 家族カレンダーを外す → 土曜は一日中空き、12/5 も空く
  await page.click('#btn-settings');
  await page.locator('[data-cal="tt:22"]').uncheck();
  await page.click('[data-close]');
  await expect(sat).toContainText('9:00 〜 23:00');
  await expect(trip).toContainText('9:00 〜 23:00');
});

test('予定を「空きとして数える」にできる・前後の余裕・コピー用の文章', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);

  // 予定の前後に30分 → 今日は 10:00〜12:30 / 17:30〜23:00
  await page.click('#btn-settings');
  await page.locator('[data-set="buffer"]').selectOption('30');
  await page.click('[data-close]');
  await expect(page.locator('#summary')).toContainText('いま空いています(12:30まで)');

  // 「バイト」を空きとして数える → 今日は全部空き
  await page.locator('#panel-week .busy', { hasText: 'バイト' }).click();
  await page.locator('[data-ignore]').check();
  await page.click('[data-close]');
  await expect(page.locator('#summary')).toContainText('いま空いています(23:00まで)');

  await page.click('.seg [data-view="list"]');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#copy-list');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split('\n').slice(0, 3)).toEqual(['空いている時間', '11/27(金) 10:00〜23:00', '11/28(土) 9:00〜17:30, 20:30〜23:00']);
});

test('ICSファイル: くり返し・EXDATE・1回だけの変更(RECURRENCE-ID)', async ({ page }) => {
  await openApp(page);
  const ics = [
    'BEGIN:VCALENDAR', 'X-WR-CALNAME:授業',
    'BEGIN:VEVENT', 'UID:x1', 'SUMMARY:英語', 'DTSTART;TZID=Asia/Tokyo:20261102T090000', 'DTEND;TZID=Asia/Tokyo:20261102T103000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,FR', 'EXDATE;TZID=Asia/Tokyo:20261130T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x1', 'RECURRENCE-ID;TZID=Asia/Tokyo:20261127T090000', 'SUMMARY:英語(補講)', 'DTSTART;TZID=Asia/Tokyo:20261127T140000', 'DTEND;TZID=Asia/Tokyo:20261127T153000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x2', 'SUMMARY:空き扱い', 'TRANSP:TRANSPARENT', 'DTSTART:20261127T030000Z', 'DTEND:20261127T040000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  await page.click('#btn-import');
  await page.setInputFiles('#ics-file', { name: 'jugyo.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
  await expect(page.locator('#toast')).toContainText('「授業」を読み込みました');
  await page.click('.seg [data-view="list"]');
  // 今日(金): 9:00の回は14:00〜15:30に移動 → 10:00〜14:00 と 15:30〜23:00
  const fri = page.locator('#panel-list .dlist li', { hasText: '11/27(金)' });
  await expect(fri).toContainText('10:00 〜 14:00');
  await expect(fri).toContainText('15:30 〜 23:00');
  // 11/30(月) は EXDATE で休み → 8:00から空き、12/4(金) はふつうに 9:00〜10:30 が予定
  await expect(page.locator('#panel-list .dlist li', { hasText: '11/30(月)' })).toContainText('8:00 〜 23:00');
  await expect(page.locator('#panel-list .dlist li', { hasText: '12/4(金)' })).toContainText('10:30 〜 23:00');
});

test('月の表示: 日ごとの空き時間と、押すとその日の予定', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await page.click('.seg [data-view="month"]');
  await expect(page.locator('#panel-month .nav-title')).toHaveText('2026年11月');
  const cell = page.locator('.mcell:not(.out)', { hasText: /^\s*28/ });
  await expect(cell).toContainText('12h'); // 9〜23時の14時間から外食の2時間
  await cell.click();
  await expect(page.locator('#sheet')).toContainText('家族で外食');
  await expect(page.locator('#sheet')).toContainText('空き 9時間');
});

// ---- manaba課題アプリの授業を入れる ----
const helpers = require('./helpers');
const CLASSES = {
  '5-2': { name: '情報社会論', room: '7201', source: 'manaba' }, // 金2限 10:50〜12:20
  '1-1': { name: '教育課程論', room: '', source: 'manaba' },     // 月1限 9:10〜10:40
};

test('manabaアプリ: 時間割から授業の時間をコピーする(休講日は入れない)', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await helpers.openApp(page, { time: NOW, state: helpers.makeState({ classes: CLASSES }), hash: 'timetable' });
  await page.click('#btn-send-aki');
  await expect(page.locator('#toast')).toContainText('コピーしました');
  const data = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(data.kind).toBe('aki-classes');
  const fri = data.items.filter((x) => x.title === '情報社会論');
  expect(fri[0]).toMatchObject({ date: '2026-11-27', start: '10:50', end: '12:20', period: 2, room: '7201' });
  // 冬季休業(12/25〜1/7)と 1/15(休講日)の金曜は入らない
  expect(fri.map((x) => x.date)).not.toContain('2027-01-01');
  expect(fri.map((x) => x.date)).not.toContain('2027-01-15');
  expect(fri.map((x) => x.date)).toContain('2027-01-08');
  // 前の日より前は入らない
  expect(data.items.every((x) => x.date >= '2026-11-26')).toBe(true);
});

test('空き時間アプリ: コピーした授業を取り込むと予定になり、カレンダーとして外せる', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await helpers.openApp(page, { time: NOW, state: helpers.makeState({ classes: CLASSES }), hash: 'timetable' });
  await page.click('#btn-send-aki');
  const json = await page.evaluate(() => navigator.clipboard.readText());

  await openApp(page);
  await page.click('#btn-import');
  await page.click('#paste-import');
  await expect(page.locator('#toast')).toContainText('授業の時間を取り込みました');
  // 今日(金)は 10:00〜10:50 と 12:20〜23:00 が空き
  await page.click('.seg [data-view="list"]');
  const fri = page.locator('#panel-list .dlist li', { hasText: '11/27(金)' });
  await expect(fri).toContainText('10:00 〜 10:50');
  await expect(fri).toContainText('12:20 〜 23:00');
  // 予定を押すと教室も見られる
  await page.click('.seg [data-view="week"]');
  await page.locator('#panel-week .busy', { hasText: '情報社会論' }).first().click();
  await expect(page.locator('#sheet')).toContainText('2限 ・ 教室: 7201');
  await page.click('[data-close]');
  // 授業のカレンダーを外すと、今日は全部空き
  await page.click('#btn-settings');
  await page.locator('[data-cal="mb:classes"]').uncheck();
  await page.click('[data-close]');
  await page.click('.seg [data-view="list"]');
  await expect(fri).toContainText('10:00 〜 23:00');
  // TimeTreeの取り込み日時は変わらない(授業だけでは「取り込み」扱いにしない)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('akiJikan')).importedAt)).toBeNull();
});

test('空き時間アプリ: manabaアプリと保存場所が同じなら、時間割を自動で読む', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.goto('/aki/index.html');
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('manabaPwa', JSON.stringify(s)); }, helpers.makeState({ classes: CLASSES }));
  await page.reload();
  await expect(page.locator('#panel-week .busy', { hasText: '情報社会論' })).toHaveCount(1);
  await expect(page.locator('#panel-week .busy', { hasText: '教育課程論' })).toHaveCount(1);
});

test('授業と授業の間は「空きコマ」と表示して、空き時間には数えない(設定で数えることもできる)', async ({ page }) => {
  const classes = {
    '5-2': { name: '情報社会論', source: 'manaba' }, // 金2限 10:50〜12:20
    '5-4': { name: '統計学', source: 'manaba' },     // 金4限 14:50〜16:20
  };
  await page.clock.install({ time: NOW });
  await page.goto('/aki/index.html');
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('manabaPwa', JSON.stringify(s)); }, helpers.makeState({ classes }));
  await page.reload();
  // 週: 12:20〜14:50(昼休み+3限)は空きコマ
  await expect(page.locator('#panel-week .koma')).toHaveCount(1);
  await expect(page.locator('#panel-week .koma')).toHaveAttribute('aria-label', '空きコマ 12:20〜14:50');
  // リスト: 今日の空きは 10:00〜10:50 と 16:20〜23:00 だけ
  await page.click('.seg [data-view="list"]');
  const fri = page.locator('#panel-list .dlist li', { hasText: '11/27(金)' });
  await expect(fri.locator('.slot')).toHaveCount(2);
  await expect(fri).toContainText('10:00 〜 10:50');
  await expect(fri).toContainText('16:20 〜 23:00');
  // その日の詳細にも「空きコマ」
  await fri.locator('.dl-head').click();
  await expect(page.locator('#sheet')).toContainText('空きコマ 2時間30分');
  await page.click('[data-close]');
  // 設定で「空きコマも数える」にすると空き時間に入る
  await page.click('#btn-settings');
  await page.locator('[data-set="komaFree"]').check();
  await page.click('[data-close]');
  await expect(fri).toContainText('12:20 〜 14:50');
});

// ---- 空き時間アプリから TimeTree に予定を入れる ----
async function bookmarkletCode(page) {
  await page.goto('/aki/bookmarklet.html');
  await page.waitForFunction(() => document.getElementById('code').value.startsWith('javascript:'));
  return page.$eval('#code', (e) => e.value);
}

test('空き時間アプリ: 空きを押して予定を入れると「追加待ち」になり、ブックマーク用にコピーされる', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);

  await page.click('.seg [data-view="list"]');
  // 明日 20:00〜23:00 の空きを押す
  await page.locator('#panel-list .dlist li', { hasText: '11/28(土)' }).locator('.slot', { hasText: '20:00' }).click();
  await expect(page.locator('#add-form [name="start"]')).toHaveValue('20:00');
  await expect(page.locator('#add-form [name="end"]')).toHaveValue('21:00');
  await page.fill('#add-form [name="title"]', 'カラオケ');
  await expect(page.locator('#add-form')).toContainText('カレンダー自分用カレンダー'); // 選べない(自分用だけ)
  await page.click('#add-form button[type="submit"]');
  await expect(page.locator('#sheet')).toContainText('追加する予定(1件)をコピーしました');

  const data = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(data.kind).toBe('aki-add');
  expect(data.items).toEqual([{ cal: '11', title: 'カラオケ', allDay: false, s: at(2026, 11, 28, 20), e: at(2026, 11, 28, 21), tz: 'Asia/Tokyo' }]);
  await page.click('[data-close]');
  // 「＋ 予定」タブに追加待ちとして出る
  await expect(page.locator('#add-extra')).toContainText('TimeTreeに追加待ち(1件)');
  await expect(page.locator('#add-extra')).toContainText('カラオケ');
  await expect(page.locator('#add-form [name="title"]')).toHaveValue('');
  await page.click('.seg [data-view="list"]');

  // 追加待ちの間は空き時間から外れる
  const sat = page.locator('#panel-list .dlist li', { hasText: '11/28(土)' });
  await expect(sat).toContainText('21:00 〜 23:00');
  await expect(sat).not.toContainText('20:00 〜 23:00');

  // TimeTreeに入った予定を取り込むと「追加待ち」は消える。入っていない予定は残る
  const imported = JSON.parse(json);
  imported.events.push({ id: 'new', cal: '11', title: 'カラオケ', allDay: false, s: at(2026, 11, 28, 20), e: at(2026, 11, 28, 21), stz: 'Asia/Tokyo', etz: 'Asia/Tokyo' });
  await importJson(page, JSON.stringify(imported));
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('akiJikan')));
  expect(st.events.filter((e) => e.pending)).toEqual([]);
  expect(st.events.filter((e) => e.title === 'カラオケ').length).toBe(1);
});

test('ブックマークレット: コピーした予定をTimeTreeに追加する(CSRFトークン付き・同じ予定は入れない)', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.install({ time: NOW });
  const code = await bookmarkletCode(page);
  await mockTimeTree(page);
  await page.route('**/api/v1/user', (r) => r.fulfill({ json: { user: { id: 777 } } }));
  const posted = [];
  await page.route('**/api/v1/calendar/*/event', (r) => {
    posted.push({ url: r.request().url(), headers: r.request().headers(), body: JSON.parse(r.request().postData()) });
    r.fulfill({ json: { event: { id: 'x' } } });
  });
  await page.goto('/tests/fixtures/timetree.html');
  const addItems = [
    { cal: '22', title: 'カラオケ', allDay: false, s: at(2026, 11, 28, 20), e: at(2026, 11, 28, 21), tz: 'Asia/Tokyo' },
    { cal: '22', title: '家族で外食', allDay: false, s: at(2026, 11, 28, 18), e: at(2026, 11, 28, 20), tz: 'Asia/Tokyo' }, // もうある
    { cal: '11', title: '旅行の準備', allDay: true, s: at(2026, 12, 4), e: at(2026, 12, 5), tz: 'Asia/Tokyo' },
  ];
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  // 標準の入力ダイアログに貼り付ける
  page.once('dialog', (d) => { expect(d.type()).toBe('prompt'); d.accept(JSON.stringify({ kind: 'aki-add', v: 1, items: addItems })); });
  await page.locator('#aki-timetree-overlay button', { hasText: 'コピーした予定をTimeTreeに追加' }).click();
  const ov = page.locator('#aki-timetree-overlay');
  await expect(ov).toContainText('カラオケ ・ 11/28(土) 20:00〜21:00 ・ 家族');
  expect(posted).toHaveLength(0); // 「追加する」を押すまでは書き込まない
  await ov.locator('button', { hasText: '追加する' }).click();
  await expect(ov).toContainText('追加しました: 2件(すでにあった1件は追加せず)');
  await expect(ov).toContainText('読み取りました'); // そのまま読み直してコピーできる

  expect(posted).toHaveLength(2);
  expect(posted[0].url).toMatch(/\/api\/v1\/calendar\/22\/event$/);
  expect(posted[0].headers['x-csrf-token']).toBe('test-csrf-123');
  expect(posted[0].body).toMatchObject({ title: 'カラオケ', all_day: false, start_at: at(2026, 11, 28, 20), end_at: at(2026, 11, 28, 21), start_timezone: 'Asia/Tokyo', attendees: [777], category: 1, label_id: 1 });
  // 終日はUTCの0時・終わりは最終日
  expect(posted[1].url).toMatch(/\/calendar\/11\/event$/);
  expect(posted[1].body).toMatchObject({ title: '旅行の準備', all_day: true, start_at: Date.UTC(2026, 11, 4), end_at: Date.UTC(2026, 11, 4), start_timezone: 'UTC' });
});

test('ブックマークレット: 追加する予定がコピーされていないとき', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const code = await bookmarkletCode(page);
  await page.goto('/tests/fixtures/timetree.html');
  page.once('dialog', (d) => d.accept('こんにちは'));
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  await page.locator('#aki-timetree-overlay button', { hasText: 'コピーした予定をTimeTreeに追加' }).click();
  await expect(page.locator('#aki-timetree-overlay')).toContainText('追加する予定が見つかりませんでした');
});

test('週の画面: 緑の空き時間を押すと「＋ 予定」タブが開き、その時間が入る', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  // 今日の 17:00〜23:00(バイトのあと)
  await page.locator('#panel-week .free[aria-label="空き 17:00〜23:00"]').click();
  await expect(page.locator('.seg [data-view="add"]')).toHaveClass(/on/);
  await expect(page.locator('#panel-add')).toBeVisible();
  await expect(page.locator('#add-form [name="date"]')).toHaveValue('2026-11-27');
  await expect(page.locator('#add-form [name="start"]')).toHaveValue('17:00');
  await expect(page.locator('#add-form [name="end"]')).toHaveValue('18:00');
});

test('「＋ 予定」タブ: 日付を選ぶとその日の空きが出て、押すと時間に入る。入力中の文字は描き直しで消えない', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await page.click('.seg [data-view="add"]');
  const f = page.locator('#add-form');
  await f.locator('[name="title"]').fill('買い物');
  await f.locator('[name="date"]').fill('2026-11-28');
  await f.locator('[name="date"]').dispatchEvent('change');
  await expect(page.locator('#add-slots')).toContainText('9:00〜18:00');
  await page.locator('#add-slots .fchip', { hasText: '20:00〜23:00' }).click();
  await expect(f.locator('[name="start"]')).toHaveValue('20:00');
  await expect(f.locator('[name="end"]')).toHaveValue('21:00');
  // 1分ごとの描き直しがあっても入力は残る
  await page.clock.runFor(61000);
  await expect(f.locator('[name="title"]')).toHaveValue('買い物');
});

test('「＋ 予定」: 前に別のカレンダーで入れた追加待ちも、自分用カレンダーに直してコピーする', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('akiJikan'));
    st.events.push({ id: 'p:old', cal: 'tt:22', title: '前の予定', allDay: false, s: 1, e: 2, pending: true });
    localStorage.setItem('akiJikan', JSON.stringify(st));
  });
  await page.reload();
  await page.click('.seg [data-view="add"]');
  await page.click('#pending-copy');
  const data = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(data.items.map((x) => x.cal)).toEqual(['11']);
});

test('「＋ 予定」: 自分用カレンダーがないときは案内を出す', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  const data = JSON.parse(json);
  data.calendars = data.calendars.filter((c) => c.name !== '自分用カレンダー');
  await openApp(page);
  await importJson(page, JSON.stringify(data));
  await page.click('.seg [data-view="add"]');
  await expect(page.locator('#add-box')).toContainText('「自分用カレンダー」が見つかりません');
});

test('追加待ち: TimeTreeから戻ると「追加できた?」と聞かれ、押すと追加待ちから消える(空き時間からは外したまま)', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await page.click('.seg [data-view="add"]');
  const f = page.locator('#add-form');
  await f.locator('[name="title"]').fill('カラオケ');
  await f.locator('[name="date"]').fill('2026-11-28');
  await f.locator('[name="start"]').fill('20:00');
  await f.locator('[name="end"]').fill('21:00');
  await f.locator('button[type="submit"]').click();
  await page.click('[data-close]');
  // TimeTreeに行って戻ってきた
  await page.clock.runFor(30000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#sheet-title')).toHaveText('TimeTreeに追加できましたか?');
  await page.locator('#sheet #pending-done').click();
  await expect(page.locator('#toast')).toContainText('追加待ちから消しました(1件)');
  await expect(page.locator('#add-extra')).not.toContainText('追加待ち');
  // 空き時間からは外れたまま
  await page.click('.seg [data-view="list"]');
  await expect(page.locator('#panel-list .dlist li', { hasText: '11/28(土)' })).toContainText('21:00 〜 23:00');
  await expect(page.locator('#panel-list .dlist li', { hasText: '11/28(土)' })).not.toContainText('20:00 〜 23:00');
  // もう一度戻ってきても、もう聞かない
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#sheet')).not.toBeVisible();
});

test('追加待ち: 「＋ 予定」タブのボタンでも消せる/取り込み直しは名前の前後の空白や秒の違いを気にしない', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('akiJikan'));
    st.events.push({ id: 'p:a', cal: 'tt:11', title: 'A', allDay: false, s: new Date(2026, 10, 29, 9).getTime(), e: new Date(2026, 10, 29, 10).getTime(), pending: true });
    st.events.push({ id: 'p:b', cal: 'tt:11', title: 'B', allDay: false, s: new Date(2026, 10, 30, 9).getTime(), e: new Date(2026, 10, 30, 10).getTime(), pending: true });
    localStorage.setItem('akiJikan', JSON.stringify(st));
  });
  await page.reload();
  // TimeTree側では「A 」(空白つき)・開始が20秒ずれて入っていた
  const data = JSON.parse(json);
  data.events.push({ id: 'ta', cal: '11', title: 'A ', allDay: false, s: new Date(2026, 10, 29, 9, 0, 20).getTime(), e: new Date(2026, 10, 29, 10).getTime(), stz: 'Asia/Tokyo', etz: 'Asia/Tokyo' });
  await importJson(page, JSON.stringify(data));
  await page.click('.seg [data-view="add"]');
  await expect(page.locator('#add-extra')).toContainText('TimeTreeに追加待ち(1件)');
  await expect(page.locator('#add-extra')).toContainText('B');
  await page.click('#add-extra #pending-done');
  await expect(page.locator('#add-extra')).not.toContainText('追加待ち');
});

// ---- シフト希望の文章 ----
async function withEvents(page, list) {
  await page.evaluate((list) => {
    const st = JSON.parse(localStorage.getItem('akiJikan'));
    list.forEach(([id, title, s, e]) => st.events.push({ id, cal: 'tt:11', title, allDay: false, s, e }));
    localStorage.setItem('akiJikan', JSON.stringify(st));
  }, list);
  await page.reload();
}

test('シフト: 次の週(月〜日)の、営業時間のうち3時間以上空いている時間で文章を作る', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.install({ time: NOW }); // 金曜 → 次の週は 11/30(月)〜12/6(日)
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await withEvents(page, [
    ['x1', '歯医者', at(2026, 12, 1, 12), at(2026, 12, 1, 13)],     // 火: 昼は1時間ずつしか空かない → 昼なし
    ['x2', '飲み会', at(2026, 12, 2, 18), at(2026, 12, 2, 19, 30)], // 水: 19:30〜ラスト
    ['x3', '用事', at(2026, 12, 3, 20, 20), at(2026, 12, 3, 21)],   // 木: 16:00〜20:00(20:20 → 20:00 に切り捨て)
    ['x4', 'ライブ', at(2026, 12, 4, 10), at(2026, 12, 4, 23)],     // 金: なし
  ]);
  await page.click('.seg [data-view="shift"]');
  await expect(page.locator('#panel-shift .nav-title')).toHaveText('11/30(月) 〜 12/6(日)');
  const text = await page.locator('#shift-text').inputValue();
  expect(text).toBe([
    'お疲れ様です！',
    '希望シフト以下の通りでよろしくお願いします。',
    '',
    '11月30日11時-14時', // 月: ゼミ 9:00〜10:30 のあと
    '11月30日16時-ラスト',
    '12月1日16時-ラスト',
    '12月2日11時-14時',
    '12月2日19時30分-ラスト',
    '12月3日11時-14時',
    '12月3日16時-20時',
    '12月5日11時-14時',
    '12月5日16時-ラスト',
    '12月6日11時-14時',
    '12月6日16時-ラスト',
    '',
    'よろしくお願いします！',
  ].join('\n'));
  await page.click('#shift-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
});

test('シフト: 授業の日は、授業と空きコマの時間を除く/手で直した文章は描き直しで消えない', async ({ page }) => {
  const classes = { '1-2': { name: '情報社会論', source: 'manaba' }, '1-4': { name: '統計学', source: 'manaba' } }; // 月2限・月4限
  await page.clock.install({ time: NOW });
  await page.goto('/aki/index.html');
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('manabaPwa', JSON.stringify(s)); }, helpers.makeState({ classes }));
  await page.reload();
  await page.click('.seg [data-view="shift"]');
  const ta = page.locator('#shift-text');
  // 月曜は 10:50〜16:20 が学校 → 16:30〜ラスト(16:20 → 16:30 に切り上げ)
  await expect(ta).toHaveValue(/11月30日16時30分-ラスト\n12月1日11時-14時/);
  await expect(ta).not.toHaveValue(/11月30日11時/);
  await ta.fill('お疲れ様です！ 直しました');
  await page.locator('#panel-shift .hint').click(); // 入力から外す
  await page.clock.runFor(61000);
  await expect(ta).toHaveValue('お疲れ様です！ 直しました');
  await page.click('#shift-regen');
  await expect(ta).toHaveValue(/^お疲れ様です！\n希望シフト/);
});

test('シフト: 水曜日は上に「シフトの提出日」と出て、押すとシフトのタブが開く', async ({ page }) => {
  const WED = at(2026, 11, 25, 9); // 水曜
  await page.clock.install({ time: WED });
  const { json } = await runBookmarklet(page);
  await openApp(page, { time: WED });
  await importJson(page, json);
  await page.click('#summary .shift-day');
  await expect(page.locator('#panel-shift')).toBeVisible();
  await expect(page.locator('#panel-shift .nav-title')).toHaveText('11/30(月) 〜 12/6(日)');
  // 水曜以外は出ない
  await page.clock.runFor(DAY_MS);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#summary .shift-day')).toHaveCount(0);
});
const DAY_MS = 86400000;

test('ブックマークレット: アプリの「TimeTreeを開く」で開いたページ(#aki-add=…)なら、貼り付けなしで追加の確認が出る', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const code = await bookmarkletCode(page);
  await mockTimeTree(page);
  await page.route('**/api/v1/user', (r) => r.fulfill({ json: { user: { id: 777 } } }));
  const posted = [];
  await page.route('**/api/v1/calendar/*/event', (r) => { posted.push(JSON.parse(r.request().postData())); r.fulfill({ json: { event: { id: 'x' } } }); });
  const payload = { kind: 'aki-add', v: 1, items: [{ cal: '11', title: 'カラオケ', allDay: false, s: at(2026, 11, 28, 20), e: at(2026, 11, 28, 21), tz: 'Asia/Tokyo' }] };
  await page.goto('/tests/fixtures/timetree.html#aki-add=' + encodeURIComponent(JSON.stringify(payload)));
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  const ov = page.locator('#aki-timetree-overlay');
  await expect(ov).toContainText('カラオケ ・ 11/28(土) 20:00〜21:00 ・ 自分用カレンダー');
  expect(await page.evaluate(() => location.hash)).toBe(''); // 2回目に押しても同じものは出ない
  await ov.locator('button', { hasText: '追加する' }).click();
  await expect(ov).toContainText('追加しました: 1件');
  expect(posted.map((p) => p.title)).toEqual(['カラオケ']);
});

test('アプリ: 「あと少し」の「TimeTreeを開く」には、追加する予定がアドレスに入っている', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await page.click('.seg [data-view="add"]');
  await page.fill('#add-form [name="title"]', 'カラオケ');
  await page.click('#add-form button[type="submit"]');
  const link = page.locator('#sheet a', { hasText: 'TimeTreeを開く' });
  await expect(link).toHaveAttribute('href', /#aki-add=/);
  const href = await link.getAttribute('href');
  const m = href.match(/#aki-add=(.+)$/);
  expect(JSON.parse(decodeURIComponent(m[1])).items[0]).toMatchObject({ cal: '11', title: 'カラオケ' });
});

test('ブックマークレット: 貼り付けをやめたら、もう一度貼り付けられる(ページの入力欄は使わない)', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const code = await bookmarkletCode(page);
  await mockTimeTree(page);
  await page.goto('/tests/fixtures/timetree.html');
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#aki-timetree-overlay button', { hasText: 'コピーした予定をTimeTreeに追加' }).click();
  const ov = page.locator('#aki-timetree-overlay');
  await expect(ov).toContainText('貼り付けられませんでした');
  await expect(ov.locator('textarea')).toHaveCount(0);
  const payload = { kind: 'aki-add', v: 1, items: [{ cal: '11', title: 'カラオケ', allDay: false, s: at(2026, 11, 28, 20), e: at(2026, 11, 28, 21), tz: 'Asia/Tokyo' }] };
  page.once('dialog', (d) => d.accept(JSON.stringify(payload)));
  await ov.locator('button', { hasText: 'もう一度貼り付ける' }).click();
  await expect(ov).toContainText('カラオケ ・ 11/28(土) 20:00〜21:00 ・ 自分用カレンダー');
});

test('シフト: 土日は23:30まで(ラスト=23:30)', async ({ page }) => {
  await page.clock.install({ time: NOW });
  const { json } = await runBookmarklet(page);
  await openApp(page);
  await importJson(page, json);
  await withEvents(page, [
    ['y1', '練習', at(2026, 12, 5, 16), at(2026, 12, 5, 20, 30)], // 土: 20:30〜23:30 の3時間 → 入る
    ['y2', '練習', at(2026, 12, 1, 16), at(2026, 12, 1, 19, 30)], // 火: 19:30〜22:30 の3時間 → 入る
    ['y3', '練習', at(2026, 12, 2, 16), at(2026, 12, 2, 20, 0)],  // 水: 20:00〜22:30 は2.5時間 → 入らない
  ]);
  await page.click('.seg [data-view="shift"]');
  const ta = page.locator('#shift-text');
  await expect(ta).toHaveValue(/12月5日20時30分-ラスト/);
  await expect(ta).toHaveValue(/12月1日19時30分-ラスト/);
  await expect(ta).not.toHaveValue(/12月2日20時/);
});
