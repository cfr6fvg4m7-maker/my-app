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

test('大学への行き方: 着きたい時刻(初期値は次の授業の10分前)で調べるリンク', async ({ page }) => {
  await openApp(page, { state: makeState({ classes }), time: at(2026, 11, 25, 20) }); // 水曜の夜 → 明日(木)1限
  await expect(page.locator('#commute .commute-head')).toContainText('次: 明日 1限 09:10〜');
  const main = page.locator('#commute a.primary');
  await expect(main).toHaveText('明日 09:00着で電車を調べる(Googleマップ)');
  // 2026/11/26 09:00 を UTC とみなした秒、6e1 = 到着、3e3 = 電車
  const g = decodeURIComponent(await main.getAttribute('href'));
  expect(g.startsWith('https://www.google.com/maps/dir//')).toBe(true); // 出発地が空 = 現在地
  expect(g).toContain('文教大学 越谷キャンパス');
  expect(g).toContain(`!6e1!7e2!8j${Date.UTC(2026, 10, 26, 9, 0) / 1000}!3e3`);

  // くわしく: 出発地と時刻を変える
  await page.click('#commute .commute-more summary');
  await expect(page.locator('#commute input[type=time]')).toHaveValue('09:00');
  await page.click('#commute .commute-from .link-btn');
  await page.fill('#form-home input[name=home]', '春日部駅');
  await page.click('#form-home button[value=ok]');
  await expect(page.locator('#commute .commute-from')).toContainText('春日部駅');
  await page.fill('#commute input[type=time]', '13:00');
  await page.dispatchEvent('#commute input[type=time]', 'change');
  await expect(main).toHaveText('明日 13:00着で電車を調べる(Googleマップ)');
  const g2 = decodeURIComponent(await main.getAttribute('href'));
  expect(g2).toContain('/maps/dir/春日部駅/');
  expect(g2).toContain(`!8j${Date.UTC(2026, 10, 26, 13, 0) / 1000}!`);
  // 元に戻す
  await page.click('#commute .commute-arrive .link-btn');
  await expect(page.locator('#commute input[type=time]')).toHaveValue('09:00');
  // 出発地はバックアップ用のデータには入れない
  expect(JSON.stringify(await page.evaluate(() => localStorage.getItem('manabaPwa')))).not.toContain('春日部');
});

test('その他タブ: 取り込みの入口・設定・バックアップがまとまっている', async ({ page }) => {
  await openApp(page, { state: makeState(), hash: 'settings' });
  await expect(page.locator('#page-title')).toHaveText('その他');
  await expect(page.locator('.topbar-actions')).toBeHidden();
  await expect(page.locator('#open-todo')).toHaveAttribute('href', /home_library_query/);
  await expect(page.locator('#open-course')).toHaveAttribute('href', /home_course/);
  await expect(page.locator('#set-calendar')).toContainText('2026年度');
  await page.click('.tab[data-view=tasks]');
  await expect(page.locator('.topbar-actions')).toBeVisible();
});
