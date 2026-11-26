// やることリスト・試験の予定・バックアップ
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { at, makeState, openApp, saved } = require('./helpers');

test.beforeEach(({ page }) => page.on('dialog', (d) => d.accept()));

test('すぐ追加: 今日/明日/今週末/日付指定と、締切ごとのグループ', async ({ page }) => {
  await openApp(page, { state: makeState(), hash: 'tasks', time: at(2026, 11, 26, 20) });
  const add = async (title, when) => {
    await page.fill('#quick-todo input[name=title]', title);
    if (when.startsWith('20')) {
      await page.fill('#quick-todo input[name=date]', when);
      await page.dispatchEvent('#quick-todo input[name=date]', 'change');
      await expect(page.locator('#when-pick-label')).toContainText('📅');
    } else {
      await page.click(`[data-when=${when}]`);
    }
    await page.click('#quick-todo button[type=submit]');
  };
  await add('洗濯', 'today');
  await add('教科書を買う', 'tomorrow');
  await add('小テスト勉強', 'weekend'); // 11/28(土)
  await add('ゼミ資料', '2026-12-20');
  const groups = await page.locator('.task-group h3').allInnerTexts();
  expect(groups.map((g) => g.replace(/\d+$/, '').trim())).toEqual(['今日', '明日', '1週間以内', 'それより先']);
  await expect(page.locator('#view-tasks .task', { hasText: '小テスト勉強' })).toContainText('11/28(土)');
  await page.click('#task-filter button:has-text("manabaの課題")');
  await expect(page.locator('#empty')).toBeVisible();
});

test('授業を選んでやること・試験を追加し、コマの画面に出る', async ({ page }) => {
  const classes = { '4-3': { name: '物理学概論', courses: [{ name: '物理学概論', url: '' }] } };
  await openApp(page, { state: makeState({ classes }), hash: 'timetable' });
  await page.locator('.tt-cell').nth(2 * 6 + 3).click();
  await page.locator('#class-extra button', { hasText: 'やること' }).click();
  await page.fill('#form-todo input[name=title]', 'レポートの下書き');
  await page.click('#form-todo button[value=ok]');
  await expect(page.locator('#class-tasks')).toContainText('レポートの下書き');

  await page.locator('#class-extra button', { hasText: '試験の予定' }).click();
  await expect(page.locator('#exam-hint')).toHaveText('定期試験期間: 1/20(水)〜1/26(火)');
  await expect(page.locator('#form-exam input[name=date]')).toHaveValue('2027-01-20');
  await page.selectOption('#form-exam select[name=period]', '2');
  await page.click('#form-exam button[value=ok]');
  await expect(page.locator('#class-extra')).toContainText('1/20(水) 2限');

  // 削除
  await page.locator('#class-extra .exam-row').click();
  await page.click('#btn-exam-del');
  expect((await saved(page)).exams).toEqual([]);
});

test('バックアップを書き出して、消えたデータを元に戻せる', async ({ page }) => {
  const tasks = [{ id: 'a', source: 'todo', title: '残したいやること', course: '', end: at(2026, 11, 30, 23, 59), allDay: true, done: false }];
  await openApp(page, { state: makeState({ tasks }), hash: 'tasks' });
  await page.click('#btn-backup');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  expect(download.suggestedFilename()).toBe('manaba-backup-2026-11-26.json');
  // ファイルの中身をそのまま渡す(保存先のパスに日本語が入ると読み込めない環境があるため)
  const buffer = fs.readFileSync(await download.path());

  await page.evaluate(() => localStorage.removeItem('manabaPwa'));
  await page.reload();
  await expect(page.locator('#view-tasks .task')).toHaveCount(0);
  await page.click('#btn-backup');
  await page.setInputFiles('#file-import', { name: 'backup.json', mimeType: 'application/json', buffer });
  await expect(page.locator('#view-tasks .task .title')).toHaveText('残したいやること');
});
