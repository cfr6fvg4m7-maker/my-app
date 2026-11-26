// Bナビ(MYスケジュール)から教室を取り込む
const { test, expect } = require('@playwright/test');
const { at, makeState, openApp, saved } = require('./helpers');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function runBookmarklet(page) {
  await page.evaluate((src) => {
    const s = document.createElement('script');
    s.src = src + '?t=' + Date.now();
    document.body.appendChild(s);
  }, new URL('/bookmarklet.js', page.url()).href);
  await page.waitForSelector('#manaba-pwa-overlay');
}

test('曜日ごとにためて、まとめて取り込む(Ⅱ/２の違い・前半後半のコマも)', async ({ page }) => {
  await page.goto('/tests/fixtures/bnavi-schedule.html');
  await page.evaluate(() => localStorage.clear());
  await runBookmarklet(page);
  await expect(page.locator('#manaba-pwa-overlay div').first()).toHaveText('教室を読み取りました(木曜)');
  await page.click('#manaba-pwa-overlay button:has-text("閉じる")');
  await page.evaluate(() => window.showMonday());
  await runBookmarklet(page);
  await expect(page.locator('#manaba-pwa-overlay div').first()).toHaveText('教室を読み取りました(月・木曜)');
  const json = await page.$eval('#manaba-pwa-overlay textarea', (e) => e.value);
  expect(JSON.parse(json).days).toHaveLength(2);

  const classes = {
    '4-1': { name: '英語Ⅱ(AD)', courses: [{ name: '英語Ⅱ(AD)', url: '' }], source: 'manaba' },
    '4-2': { name: '教科概説「社会」(B2) / 教科概説「算数」(B1)', courses: [{ name: '教科概説「社会」(B2)', url: '' }, { name: '教科概説「算数」(B1)', url: '' }] },
    '4-3': { name: '物理学概論', room: '古い教室' },
    '4-4': { name: '教職概論(AC)' },
    '1-2': { name: '教育課程論(AB) / 教育方法論(AB)', courses: [{ name: '教育課程論(AB)', url: '' }, { name: '教育方法論(AB)', url: '' }] },
  };
  await openApp(page, { state: makeState({ classes }), time: at(2026, 11, 26, 10, 0) });
  await page.evaluate((v) => navigator.clipboard.writeText(v), json);
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('教室を7件入れました(月・木曜)');
  await expect(page.locator('#toast')).toContainText('時間割にない授業: 教科概説「体育」(B2)');

  const c = (await saved(page)).timetable.terms['2026-fall'].classes;
  expect(c['4-1'].room).toBe('6301教室');
  expect(c['4-3'].room).toBe('1301教室');
  expect(c['4-2'].rooms).toEqual({ '教科概説「社会」(B2)': '8501教室', '教科概説「算数」(B1)': '13201教室' });
  expect(c['1-2'].rooms['教育方法論(AB)']).toBe('5102教室');

  // 今日画面: 木2 は後半(算数)なので 13201教室
  await page.click('.tab[data-view=today]');
  await expect(page.locator('.today-class', { hasText: '算数' })).toContainText('13201教室');
  await expect(page.locator('.today-class', { hasText: '英語' })).toContainText('6301教室');
});
