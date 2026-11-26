// ブックマークレットが manaba の表を正しく読み取るか(未提出課題一覧・コース一覧の曜日表示)
const { test, expect } = require('@playwright/test');

async function codes(page) {
  await page.goto('/bookmarklet.html');
  await page.waitForFunction(() => document.getElementById('code').value.startsWith('javascript:'));
  const long = await page.$eval('#code', (e) => e.value);
  return { long };
}

async function run(page, fixture, code) {
  await page.goto(`/tests/fixtures/${fixture}`);
  await page.evaluate((c) => { eval(decodeURIComponent(c.slice('javascript:'.length))); }, code);
  await page.waitForSelector('#manaba-pwa-overlay');
  return {
    message: await page.$eval('#manaba-pwa-overlay div', (e) => e.textContent),
    data: JSON.parse(await page.$eval('#manaba-pwa-overlay textarea', (e) => e.value)),
  };
}

test('未提出課題一覧: 締切のない課題は除外', async ({ page }) => {
  const { long } = await codes(page);
  const { message, data } = await run(page, 'manaba-tasks.html', long);
  expect(message).toContain('3件の課題を読み取りました');
  expect(data.kind).toBe('tasks');
  expect(data.skipped).toBe(1);
  expect(data.items.map((x) => x.title)).toEqual(['第8回 レポート課題', '確認テスト5', '期末レポート']);
  expect(data.items[0]).toMatchObject({ course: '情報社会論 (月2)', end: '2026-11-26 23:59' });
  expect(data.items[0].url).toMatch(/\/ct\/course_1_report_11$/);
});

test('コース一覧(曜日): 1コマに2つの授業も読む', async ({ page }) => {
  const { long } = await codes(page);
  const { message, data } = await run(page, 'manaba-courses.html', long);
  expect(message).toContain('11コマ・授業15件');
  expect(data.kind).toBe('timetable');
  const slot = (d, p) => data.slots.find((s) => s.day === d && s.period === p);
  expect(slot(1, 2).courses.map((c) => c.name)).toEqual(['教育課程論(AB)', '教育方法論(AB)']);
  expect(slot(4, 4).courses.map((c) => c.name)).toEqual(['教職概論(AC)']);
  // アイコンのリンク(…_news など)や「※リンク中」は入らない
  expect(JSON.stringify(data)).not.toContain('_news');
  expect(JSON.stringify(data)).not.toContain('リンク中');
});

test('短いコード(本体を読み込む形)でも同じように動く', async ({ page }) => {
  await page.goto('/bookmarklet.html');
  await page.waitForFunction(() => !document.getElementById('copy-short').disabled);
  const jsUrl = new URL('/bookmarklet.js', page.url()).href;
  await page.goto('/tests/fixtures/manaba-tasks.html');
  await page.evaluate((src) => {
    const s = document.createElement('script');
    s.src = src;
    document.body.appendChild(s);
  }, jsUrl);
  await page.waitForSelector('#manaba-pwa-overlay');
  await expect(page.locator('#manaba-pwa-overlay div').first()).toContainText('3件の課題を読み取りました');
});
