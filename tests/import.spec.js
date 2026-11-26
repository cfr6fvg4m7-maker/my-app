// manaba からの取り込み(課題・時間割)と、古いデータ形式からの変換
const { test, expect } = require('@playwright/test');
const { at, makeState, openApp, saved, text } = require('./helpers');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const tasksData = (items) => JSON.stringify({ app: 'manaba-pwa', v: 1, kind: 'tasks', items, skipped: 0 });
const item = (title, end, url = `https://x/${encodeURIComponent(title)}`) => ({ type: 'レポート', title, course: '授業A', start: '', end, url });

async function paste(page, value) {
  await page.evaluate((v) => navigator.clipboard.writeText(v), value);
  await page.click('#btn-import');
}

test('課題の取り込み: 完了は残り、消えた課題には印が付く', async ({ page }) => {
  await openApp(page, { state: makeState({ lastImportAt: null }), hash: 'tasks' });
  await paste(page, tasksData([item('レポート1', '2026-11-27 18:00'), item('レポート2', '2026-11-28 22:00')]));
  await expect(page.locator('#toast')).toContainText('新規2件');
  await page.locator('#view-tasks .task', { hasText: 'レポート1' }).locator('.check').check();

  // 2回目: レポート1 はそのまま、レポート2 は一覧から消えた
  await paste(page, tasksData([item('レポート1', '2026-11-27 18:00')]));
  await expect(page.locator('#toast')).toContainText('一覧から消えた1件');
  const s = await saved(page);
  const r1 = s.tasks.find((t) => t.title === 'レポート1');
  const r2 = s.tasks.find((t) => t.title === 'レポート2');
  expect(r1.done).toBe(true);
  expect(r2.missing).toBe(true);
  await expect(page.locator('#view-tasks .task', { hasText: 'レポート2' })).toContainText('manabaの一覧にありません');
});

test('manabaのデータでなければ貼り付け画面が開く', async ({ page }) => {
  await openApp(page, { state: makeState(), hash: 'tasks' });
  await paste(page, '関係ない文字');
  await expect(page.locator('#dlg-import')).toBeVisible();
  await expect(page.locator('#import-preview')).toContainText('読み取れませんでした');
});

test('時間割の取り込み: 表示中の学期に入り、教室などは残る', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  const classes = { '4-4': { name: '教職概論(AC)', room: 'C201', credits: 2, source: 'manaba', courses: [{ name: '教職概論(AC)', url: '' }] } };
  await openApp(page, { state: makeState({ classes }), hash: 'timetable' });
  const data = {
    app: 'manaba-pwa', v: 1, kind: 'timetable',
    slots: [
      { day: 4, period: 4, courses: [{ name: '教職概論(AC)', url: 'https://x/c1' }] },
      { day: 1, period: 2, courses: [{ name: '教育課程論(AB)', url: '' }, { name: '教育方法論(AB)', url: '' }] },
    ],
  };
  await paste(page, JSON.stringify(data));
  await expect(page.locator('#toast')).toContainText('時間割を取り込みました(2コマ)');
  const c = (await saved(page)).timetable.terms['2026-fall'].classes;
  expect(c['4-4']).toMatchObject({ room: 'C201', credits: 2 });
  expect(c['1-2'].courses).toHaveLength(2);
});

test('古い形式(v1: 課題だけ)のデータを今の形式に変換する', async ({ page }) => {
  const v1 = { version: 1, lastImportAt: at(2026, 11, 26, 8), tasks: [{ id: 'a', source: 'manaba', title: '古い課題', course: '', end: at(2026, 11, 30, 23, 59), done: false }] };
  await openApp(page, { raw: JSON.stringify(v1), hash: 'tasks' });
  await expect(page.locator('#view-tasks .task .title')).toHaveText('古い課題');
  const s = await saved(page);
  expect(s.version).toBe(3);
  expect(s.timetable.terms['2026-fall']).toBeTruthy();
  expect(s.exams).toEqual([]);
});

test('学期: 4月になると春学期に自動で切り替わり、前の学期は残る', async ({ page }) => {
  const classes = { '4-3': { name: '物理学概論' } };
  await openApp(page, { state: makeState({ classes }), hash: 'timetable', time: at(2027, 4, 10, 10) });
  const s = await saved(page);
  expect(s.timetable.currentTerm).toBe('2027-spring');
  expect(Object.keys(s.timetable.terms['2026-fall'].classes)).toEqual(['4-3']);
  expect(await text(page, '#term-select')).toContain('2026年度 秋学期');
});
