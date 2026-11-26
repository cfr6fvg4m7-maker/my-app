// 年間予定(calendar.js)から作る授業日が、公式PDFの①〜⑮の番号と一致するか
const { test, expect } = require('@playwright/test');

// 2026年度 越谷キャンパス行事予定PDFから読み取った、各曜日の第1〜15回の日付
const EXPECTED = {
  '2026-spring': {
    1: '4/13 4/20 4/27 5/11 5/18 5/25 6/1 6/8 6/15 6/22 6/29 7/6 7/13 7/20 7/27',
    2: '4/14 4/21 4/28 5/5 5/12 5/19 5/26 6/2 6/9 6/16 6/23 6/30 7/7 7/14 7/21',
    3: '4/15 4/22 4/29 5/6 5/13 5/20 5/27 6/3 6/10 6/17 6/24 7/1 7/8 7/15 7/22',
    4: '4/9 4/16 4/23 4/30 5/7 5/21 5/28 6/4 6/11 6/18 6/25 7/2 7/9 7/16 7/23',
    5: '4/10 4/17 4/24 5/8 5/15 5/22 5/29 6/5 6/12 6/19 6/26 7/3 7/10 7/17 7/24',
    6: '4/11 4/18 4/25 5/9 5/16 5/23 5/30 6/6 6/13 6/20 6/27 7/4 7/11 7/18 7/25',
  },
  '2026-fall': {
    1: '9/14 9/21 9/28 10/5 10/12 10/19 10/26 11/9 11/16 11/23 11/30 12/7 12/14 12/21 1/18',
    2: '9/15 9/29 10/6 10/13 10/20 10/27 11/10 11/17 11/24 12/1 12/8 12/15 12/22 1/12 1/19',
    3: '9/16 9/30 10/7 10/14 10/21 10/28 11/4 11/11 11/18 11/25 12/2 12/9 12/16 12/23 1/13',
    4: '9/10 9/17 9/24 10/1 10/8 10/22 11/5 11/12 11/19 11/26 12/3 12/10 12/17 12/24 1/14',
    5: '9/11 9/18 9/25 10/2 10/9 10/16 10/23 11/6 11/13 11/20 11/27 12/4 12/11 12/18 1/8',
    6: '9/5 9/12 9/19 9/26 10/3 10/10 10/17 10/24 11/7 11/14 11/28 12/5 12/12 12/19 1/9',
  },
};

test('全曜日の授業日がPDFの番号どおり', async ({ page }) => {
  await page.goto('/index.html');
  const got = await page.evaluate((exp) => {
    const out = {};
    for (const term of Object.keys(exp)) {
      out[term] = {};
      for (const w of Object.keys(exp[term])) {
        out[term][w] = calClassDates(term, Number(w)).map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`).join(' ');
      }
    }
    return out;
  }, EXPECTED);
  expect(got).toEqual(EXPECTED);
});

test('休講日・休業期間・試験期間・祝日授業日', async ({ page }) => {
  await page.goto('/index.html');
  const info = await page.evaluate(() => [
    calDayInfo(new Date(2026, 10, 26)), // 普通の授業日
    calDayInfo(new Date(2026, 10, 23)), // 勤労感謝の日(授業あり)
    calDayInfo(new Date(2026, 9, 15)),  // 体育祭
    calDayInfo(new Date(2026, 11, 28)), // 冬季休業
    calDayInfo(new Date(2027, 0, 21)),  // 定期試験期間
  ]);
  expect(info.map((x) => x.type)).toEqual(['class', 'class', 'off', 'off', 'exam']);
  expect(info[1].label).toContain('勤労感謝の日');
  expect(info[2].label).toBe('体育祭');
  expect(info[3].label).toBe('冬季休業');
});
