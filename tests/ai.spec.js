// AIに相談: 頼み方の文章を作ってコピーし、Claude を開く
const { test, expect } = require('@playwright/test');
const { at, makeState, openApp, saved } = require('./helpers');

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('課題の内容を入れて、回答の方向性を提案してもらう文章を作る', async ({ page, context }) => {
  const tasks = [{ id: 'r1', source: 'manaba', type: 'レポート', title: '第１回レポート', course: '教科概説「国語」(B2)', url: 'https://x/1', end: at(2026, 11, 27, 18), done: false }];
  await openApp(page, { state: makeState({ tasks }), hash: 'tasks', time: at(2026, 11, 26, 20) });
  await page.locator('#view-tasks .task .ai-btn').click();
  await expect(page.locator('#ai-target')).toContainText('第１回レポート');
  await page.fill('#form-ai textarea[name=desc]', '教科書の第3章を読み、国語教育の目的について800字で論じなさい。');
  await page.fill('#form-ai textarea[name=mine]', '言語能力と思考力の関係を書きたい');

  const popup = context.waitForEvent('page');
  await page.click('#form-ai button[value=ok]');
  const claude = await popup;
  const url = new URL(claude.url());
  expect(url.origin + url.pathname).toBe('https://claude.ai/new');
  const q = url.searchParams.get('q');
  expect(q).toContain('【課題名】第１回レポート');
  expect(q).toContain('【授業】教科概説「国語」(B2)');
  expect(q).toContain('【締切】11/27(金) 18:00');
  expect(q).toContain('800字で論じなさい');
  expect(q).toContain('言語能力と思考力');
  expect(q).toContain('そのまま提出できる完成した文章ではなく');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(q);
  await claude.close();

  // 貼った内容は保存され、次に開くと入っている
  expect((await saved(page)).tasks[0].desc).toContain('国語教育の目的');
  await page.keyboard.press('Escape');
  await page.locator('#view-tasks .task .ai-btn').click();
  await expect(page.locator('#form-ai textarea[name=desc]')).toHaveValue(/国語教育の目的/);
});

test('下書きを読んでアドバイスでは、書き直しを頼まない', async ({ page }) => {
  const tasks = [{ id: 't', source: 'todo', title: 'ゼミ発表', course: '', end: at(2026, 12, 3, 23, 59), allDay: true, done: false }];
  await openApp(page, { state: makeState({ tasks }), hash: 'tasks' });
  await page.locator('#view-tasks .task .ai-btn').click();
  await page.check('#form-ai input[value=review]');
  await page.fill('#form-ai textarea[name=mine]', '私の下書きです。');
  await page.click('#btn-ai-copy');
  const q = await page.evaluate(() => navigator.clipboard.readText());
  expect(q).toContain('書き直した文章は示さずに');
  expect(q).toContain('【締切】12/3(木)');
});

test('そのままClaudeに聞く: 自分の質問と課題の情報だけを送る', async ({ page, context }) => {
  const tasks = [{ id: 'r1', source: 'manaba', type: 'レポート', title: '第１回レポート', course: '教科概説「国語」(B2)', url: 'https://x/1', end: at(2026, 11, 27, 18), done: false, desc: '国語教育の目的を論じなさい。' }];
  await openApp(page, { state: makeState({ tasks }), hash: 'tasks', time: at(2026, 11, 26, 20) });
  await page.locator('#view-tasks .task .ai-btn').click();
  await expect(page.locator('#ai-q-label')).toBeHidden();
  await page.check('#form-ai input[value=direct]');
  await expect(page.locator('#ai-q-label')).toBeVisible();
  await page.fill('#form-ai textarea[name=question]', 'この課題で使えそうな具体例を教えて');
  const popup = context.waitForEvent('page');
  await page.click('#form-ai button[value=ok]');
  const q = new URL((await popup).url()).searchParams.get('q');
  expect(q.startsWith('この課題で使えそうな具体例を教えて')).toBe(true);
  expect(q).toContain('【課題名】第１回レポート');
  expect(q).toContain('【課題の内容】\n国語教育の目的を論じなさい。');
  expect(q).not.toContain('完成した文章ではなく');
  expect(q).not.toContain('相談させてください');
});
