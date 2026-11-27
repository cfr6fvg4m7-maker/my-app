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
  await openApp(page, { state: makeState({ tasks }), hash: 'settings' });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  expect(download.suggestedFilename()).toBe('manaba-backup-2026-11-26.json');
  // ファイルの中身をそのまま渡す(保存先のパスに日本語が入ると読み込めない環境があるため)
  const buffer = fs.readFileSync(await download.path());

  await page.evaluate(() => localStorage.removeItem('manabaPwa'));
  await page.reload();
  await expect(page.locator('#view-tasks .task')).toHaveCount(0);
  await page.setInputFiles('#file-import', { name: 'backup.json', mimeType: 'application/json', buffer });
  await expect(page.locator('#view-tasks .task .title')).toHaveText('残したいやること');
});

test('やることを編集: 内容・日付・メモを変え、削除もできる', async ({ page }) => {
  const tasks = [{ id: 't1', source: 'todo', title: '教科書を買う', course: '', end: at(2026, 11, 27, 23, 59), allDay: true, done: false }];
  await openApp(page, { state: makeState({ tasks }), hash: 'tasks', time: at(2026, 11, 26, 20) });
  const row = page.locator('#view-tasks .task', { hasText: '教科書' });
  await row.locator('.edit').click();
  await expect(page.locator('#todo-title')).toHaveText('編集');
  await expect(page.locator('#form-todo input[name=date]')).toHaveValue('2026-11-27');
  await page.fill('#form-todo input[name=title]', '教科書を2冊買う');
  await page.fill('#form-todo input[name=date]', '2026-12-05');
  await page.fill('#form-todo input[name=time]', '12:00');
  await page.fill('#form-todo textarea[name=memo]', '生協で');
  await page.click('#btn-todo-ok');
  const edited = page.locator('#view-tasks .task', { hasText: '教科書を2冊買う' });
  await expect(edited).toContainText('12/5(土) 12:00');
  await expect(edited).toContainText('📝 生協で');
  await expect(page.locator('.task-group.later h3')).toContainText('それより先'); // 11/26 から 9日後

  await edited.locator('.edit').click();
  await page.click('#btn-todo-del');
  await expect(page.locator('#view-tasks .task')).toHaveCount(0);
});

test('manabaの課題はメモだけ書けて、取り込み直しても残る', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const tasks = [{ id: 'https://x/r1', source: 'manaba', type: 'レポート', title: 'レポート1', course: '授業A', url: 'https://x/r1', end: at(2026, 11, 28, 22), done: false }];
  await openApp(page, { state: makeState({ tasks }), hash: 'tasks' });
  await page.locator('#view-tasks .task .edit').click();
  await expect(page.locator('#todo-title')).toHaveText('メモを書く');
  await expect(page.locator('#form-todo input[name=title]')).toBeHidden();
  await page.fill('#form-todo textarea[name=memo]', 'Wordで提出・800字');
  await page.click('#btn-todo-ok');
  await expect(page.locator('#view-tasks .task')).toContainText('📝 Wordで提出・800字');

  const data = { app: 'manaba-pwa', v: 1, kind: 'tasks', skipped: 0, items: [{ type: 'レポート', title: 'レポート1', course: '授業A', start: '', end: '2026-11-29 22:00', url: 'https://x/r1' }] };
  await page.evaluate((v) => navigator.clipboard.writeText(v), JSON.stringify(data));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('更新1件');
  await expect(page.locator('#view-tasks .task')).toContainText('11/29(日) 22:00');
  await expect(page.locator('#view-tasks .task')).toContainText('📝 Wordで提出・800字');
});

test('カレンダー表示: 日ごとの件数・試験・休講日と、選んだ日の一覧', async ({ page }) => {
  const tasks = [
    { id: 'a', source: 'manaba', type: 'レポート', title: '第１回レポート', course: '', url: 'https://x/1', end: at(2026, 11, 27, 18), done: false },
    { id: 'b', source: 'todo', title: '教科書を買う', course: '', end: at(2026, 11, 27, 23, 59), allDay: true, done: false },
    { id: 'c', source: 'todo', title: '年末の課題', course: '', end: at(2026, 12, 20, 23, 59), allDay: true, done: false },
  ];
  const exams = [{ id: 'e', course: '物理学概論', kind: '小テスト', date: '2026-11-30', period: 3, memo: '' }];
  await openApp(page, { state: makeState({ tasks, exams }), hash: 'tasks', time: at(2026, 11, 26, 20) });
  await page.click('.mode-btn[data-mode=cal]');
  await expect(page.locator('.cal-head b')).toHaveText('2026年11月');
  const day = (d) => page.locator('.cal-day').filter({ has: page.locator('.cal-num', { hasText: new RegExp(`^${d}$`) }) });
  await expect(day(27).locator('.cal-count')).toHaveText('2');
  await expect(day(27).locator('.cal-count')).toHaveClass(/urgent/);
  await expect(day(30).locator('.cal-exam')).toHaveText('試');
  await expect(day(2)).toHaveClass(/off/); // 11/2 学祭片付日
  await day(27).click();
  await expect(page.locator('.cal-sel-head')).toContainText('11月27日(金)');
  await expect(page.locator('#task-cal .task')).toHaveCount(2);
  // 次の月へ
  await page.click('.cal-nav[aria-label=次の月]');
  await expect(page.locator('.cal-head b')).toHaveText('2026年12月');
  await expect(day(20).locator('.cal-count')).toHaveText('1');
  // この日にやることを追加 → 日付が入っている
  await day(20).click();
  await page.click('.cal-sel-head .link-btn');
  await expect(page.locator('#form-todo input[name=date]')).toHaveValue('2026-12-20');
  // 表示の切り替えは覚えている
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#task-cal')).toBeVisible();
});

test('カレンダー: 定期試験期間の日は色が変わる', async ({ page }) => {
  await openApp(page, { state: makeState(), hash: 'tasks', time: at(2027, 1, 10, 12) });
  await page.click('.mode-btn[data-mode=cal]');
  await expect(page.locator('.cal-head b')).toHaveText('2027年1月');
  const periodDays = await page.locator('.cal-day.exam-period .cal-num').allInnerTexts();
  expect(periodDays).toEqual(['20', '21', '22', '23', '24', '25', '26']);
  await expect(page.locator('.cal-legend')).toContainText('定期試験期間');
});
