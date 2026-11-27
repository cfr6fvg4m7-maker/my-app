// manaba からの取り込み(課題・時間割)と、古いデータ形式からの変換
const { test, expect } = require('@playwright/test');
const { at, makeState, openApp, saved, text } = require('./helpers');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const tasksData = (items) => JSON.stringify({ app: 'manaba-pwa', v: 1, kind: 'tasks', items, skipped: 0 });
const item = (title, end, url = `https://x/${encodeURIComponent(title)}`) => ({ type: 'レポート', title, course: '授業A', start: '', end, url });

// コピーしたものを読み込む(「今日」「やること」は上の②、「その他」は取り込むボタン)
async function paste(page, value) {
  await page.evaluate((v) => navigator.clipboard.writeText(v), value);
  const top = page.locator('#btn-import');
  await (await top.isVisible() ? top : page.locator('#btn-import-set')).click();
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
  await openApp(page, { state: makeState({ classes }), hash: 'settings' });
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

test('説明つきの取り込み: manabaの説明は更新し、自分で書き直した説明は残す', async ({ page }) => {
  const tasks = [
    { id: 'https://x/a', source: 'manaba', title: 'A', course: '', url: 'https://x/a', end: at(2026, 11, 28, 22), done: false, desc: '古い説明', descFrom: 'manaba' },
    { id: 'https://x/b', source: 'manaba', title: 'B', course: '', url: 'https://x/b', end: at(2026, 11, 28, 22), done: false, desc: '自分のメモ入り', descFrom: 'user' },
  ];
  await openApp(page, { state: makeState({ tasks }), hash: 'tasks' });
  const data = { app: 'manaba-pwa', v: 1, kind: 'tasks', skipped: 0, items: [
    { type: 'レポート', title: 'A', course: '', start: '', end: '2026-11-28 22:00', url: 'https://x/a', desc: '新しい説明' },
    { type: 'レポート', title: 'B', course: '', start: '', end: '2026-11-28 22:00', url: 'https://x/b', desc: 'manabaの説明' },
    { type: 'レポート', title: 'C', course: '', start: '', end: '2026-11-29 22:00', url: 'https://x/c', desc: 'Cの説明' },
  ] };
  await paste(page, JSON.stringify(data));
  await expect(page.locator('#toast')).toContainText('新規1件');
  const s = await saved(page);
  const get = (t) => s.tasks.find((x) => x.title === t);
  expect(get('A').desc).toBe('新しい説明');
  expect(get('B').desc).toBe('自分のメモ入り');
  expect(get('C')).toMatchObject({ desc: 'Cの説明', descFrom: 'manaba' });
});
