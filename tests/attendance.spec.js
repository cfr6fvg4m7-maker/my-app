// 出席の記録・欠席の残り回数・前半/後半で分かれる授業・記録し忘れ
const { test, expect } = require('@playwright/test');
const { at, makeState, openApp, saved, text } = require('./helpers');

test.beforeEach(({ page }) => page.on('dialog', (d) => d.accept()));

const classes = {
  '4-1': { name: '英語II(AD)', room: 'A201' },
  '4-3': { name: '物理学概論' },
  '1-2': { name: '教育課程論(AB) / 教育方法論(AB)', courses: [{ name: '教育課程論(AB)', url: '' }, { name: '教育方法論(AB)', url: '' }] },
};

test('授業中に1タップで記録でき、残り回数が出る', async ({ page }) => {
  await openApp(page, { state: makeState({ classes }), hash: 'timetable', time: at(2026, 11, 26, 13, 30) });
  await expect(page.locator('#tt-now')).toContainText('今 3限 物理学概論 第10回');
  await page.locator('#tt-now .att-btn.absent').click();
  await expect(page.locator('#tt-now')).toContainText('欠席 1/4回 ・ あと3回休めます');
  const att = (await saved(page)).timetable.terms['2026-fall'].attendance;
  expect(att['4-3']).toEqual([{ date: '2026-11-26', status: 'absent' }]);
});

test('記録画面: 未記録の日も並び、変更・削除できる', async ({ page }) => {
  const attendance = { '4-1': [{ date: '2026-10-08', status: 'absent' }, { date: '2026-11-19', status: 'late' }] };
  await openApp(page, { state: makeState({ classes, attendance }), hash: 'timetable' });
  await page.locator('.att-sum-row', { hasText: '英語' }).click();
  await expect(page.locator('.att-tab', { hasText: '未記録' })).toHaveText('未記録 8');
  const rows = page.locator('.att-item .att-day');
  await expect(rows.first()).toContainText('11/26(木)');
  await expect(rows.first()).toContainText('第10回');
  // 10/8 欠席 → 出席、11/19 を削除
  await page.locator('.att-item', { hasText: '10/8' }).locator('.att-btn.present').click();
  await page.locator('.att-item', { hasText: '11/19' }).locator('.att-trash').click();
  await expect(page.locator('#att-stat b')).toHaveText('欠席 0/4回 ・ あと4回休めます');
});

test('前半・後半: 授業ごとに8回で数え、日付で振り分ける', async ({ page }) => {
  // 11/30(月)2限 = 月曜第11回 → 後半の第3回
  await openApp(page, { state: makeState({ classes }), hash: 'timetable', time: at(2026, 11, 30, 11) });
  await expect(page.locator('#tt-now')).toContainText('教育方法論(AB)(後半) 第3回');
  await page.locator('#tt-now .att-btn.absent').click();
  const sums = await page.locator('.att-sum-row').allInnerTexts();
  expect(sums.join('|')).toContain('教育方法論(AB)(後半)');
  expect(sums.find((x) => x.includes('教育方法論'))).toContain('欠1/2');
  // 入れ替え
  await page.locator('.tt-cell').nth(1 * 6 + 0).click();
  await page.locator('#class-att button', { hasText: '入れ替える' }).click();
  await expect(page.locator('#class-att .att-head b').first()).toHaveText('教育方法論(AB)(前半)');
});

test('記録し忘れ: 使い始めた日以降の終わった授業だけ', async ({ page }) => {
  await openApp(page, { state: makeState({ classes, attSince: '2026-11-26' }), hash: 'timetable', time: at(2026, 11, 26, 16) });
  // 11/26(木) 1限・3限が終わっている
  await expect(page.locator('#tab-badge-tt')).toHaveText('2');
  await page.locator('#att-pending .att-pending-row', { hasText: '物理学' }).locator('.att-btn.present').click();
  await expect(page.locator('#tab-badge-tt')).toHaveText('1');
});
