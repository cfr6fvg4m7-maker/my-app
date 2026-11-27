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
    { id: 11, name: '自分', deactivated_at: null },
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
  await expect(page.locator('#aki-timetree-overlay')).toContainText('読み取りました');
  return {
    message: await page.$eval('#aki-timetree-overlay div', (e) => e.textContent),
    json: await page.$eval('#aki-timetree-overlay textarea', (e) => e.value),
  };
}

async function openApp(page, { stored } = {}) {
  await page.clock.install({ time: NOW });
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
  expect(data.calendars.map((c) => c.name)).toEqual(['自分', '家族']);
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
  const sat = page.locator('.dlist li', { hasText: '11/28(土)' });
  await expect(sat).toContainText('9:00 〜 18:00');
  await expect(sat).toContainText('20:00 〜 23:00');
  // 12/5(土) は家族の「旅行」(終日)。初期設定では終日の予定は数えない
  const trip = page.locator('.dlist li', { hasText: '12/5(土)' });
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
  const fri = page.locator('.dlist li', { hasText: '11/27(金)' });
  await expect(fri).toContainText('10:00 〜 14:00');
  await expect(fri).toContainText('15:30 〜 23:00');
  // 11/30(月) は EXDATE で休み → 8:00から空き、12/4(金) はふつうに 9:00〜10:30 が予定
  await expect(page.locator('.dlist li', { hasText: '11/30(月)' })).toContainText('8:00 〜 23:00');
  await expect(page.locator('.dlist li', { hasText: '12/4(金)' })).toContainText('10:30 〜 23:00');
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
  const fri = page.locator('.dlist li', { hasText: '11/27(金)' });
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
