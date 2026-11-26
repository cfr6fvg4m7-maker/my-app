// テストで共通に使う道具: 時計を固定し、localStorage に用意したデータを入れてアプリを開く。

const PERIODS = [
  { start: '09:10', end: '10:40' },
  { start: '10:50', end: '12:20' },
  { start: '13:10', end: '14:40' },
  { start: '14:50', end: '16:20' },
  { start: '16:30', end: '18:00' },
];

// 月は 1〜12 で書けるようにした Date のミリ秒
function at(y, m, d, h = 0, mi = 0) {
  return new Date(y, m - 1, d, h, mi).getTime();
}

// 今のデータ形式(v3)の空の状態。classes / attendance / tasks などを上書きして使う
function makeState({ tasks = [], exams = [], classes = {}, attendance = {}, term = '2026-fall', attSince, lastImportAt } = {}) {
  return {
    version: 3,
    lastImportAt: lastImportAt === undefined ? at(2026, 11, 26, 8) : lastImportAt,
    tasks,
    exams,
    timetable: {
      days: [1, 2, 3, 4, 5, 6],
      periods: PERIODS,
      rules: { sessions: 15, failRatio: 1 / 3, lateCount: 1 },
      terms: { [term]: { classes, attendance } },
      currentTerm: term,
      autoTerm: term,
      ...(attSince ? { attSince } : {}),
    },
  };
}

// 時計を time に固定し、state を保存してから hash の画面(today / tasks / timetable)を開く
async function openApp(page, { time, state, hash = '', raw } = {}) {
  await page.clock.install({ time: time ?? at(2026, 11, 26, 13, 30) });
  await page.goto('/index.html');
  await page.evaluate(({ s, r }) => {
    localStorage.clear();
    if (r !== undefined) localStorage.setItem('manabaPwa', r);
    else if (s) localStorage.setItem('manabaPwa', JSON.stringify(s));
  }, { s: state, r: raw });
  // ハッシュだけの変更では読み込み直されないので、移動してから reload する
  await page.goto(`/index.html${hash ? '#' + hash : ''}`);
  await page.reload();
  await page.waitForSelector('#page-title');
}

async function saved(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('manabaPwa')));
}

// 画面の文字を改行なしでまとめて取り出す
async function text(page, selector) {
  return (await page.locator(selector).innerText()).replace(/\s*\n\s*/g, ' / ');
}

module.exports = { PERIODS, at, makeState, openApp, saved, text };
