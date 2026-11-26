// 「今日」画面
const { test, expect } = require('@playwright/test');
const { at, makeState, openApp } = require('./helpers');

const classes = { '4-1': { name: '英語II(AD)', room: 'A201' }, '4-3': { name: '物理学概論' } };

test('開くと「今日」から始まり、今日の授業が並ぶ', async ({ page }) => {
  const tasks = [{ id: 'a', source: 'manaba', type: 'レポート', title: '明日締切', course: '', end: at(2026, 11, 27, 18), done: false }];
  await openApp(page, { state: makeState({ classes, tasks }), time: at(2026, 11, 26, 13, 30) });
  await expect(page.locator('#page-title')).toHaveText('今日');
  await expect(page.locator('#today-head')).toContainText('11月26日(木)');
  const rows = page.locator('.today-class');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('英語II(AD)');
  await expect(rows.nth(0)).toContainText('A201 ・ 第10回 ・ 終了');
  await expect(rows.nth(1)).toContainText('授業中');
  await expect(page.locator('#today-tasks')).toContainText('明日締切');
});

test('休講日は授業なしと次の授業を表示', async ({ page }) => {
  await openApp(page, { state: makeState({ classes }), time: at(2026, 10, 15, 10) });
  await expect(page.locator('#today-head')).toContainText('授業なし(体育祭)');
  await expect(page.locator('#today-classes')).toContainText('次の授業: 10月22日(木) 1限 英語II(AD)');
});

test('試験: 前日は「明日」、当日は「今日の試験」', async ({ page }) => {
  const exams = [{ id: 'e1', course: '物理学概論', kind: '定期試験', date: '2027-01-21', period: 2, memo: '範囲: 1〜10回' }];
  await openApp(page, { state: makeState({ classes, exams }), time: at(2027, 1, 20, 9) });
  await expect(page.locator('#today-exams')).toContainText('明日');
  await page.clock.setSystemTime(at(2027, 1, 21, 8));
  await page.reload();
  await expect(page.locator('#today-exams h3').first()).toHaveText('今日の試験');
  await expect(page.locator('#today-head')).toContainText('定期試験期間');
});
