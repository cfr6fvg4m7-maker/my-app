// 自動テストの設定。アプリ本体はビルド不要なので、tests/server.js で静的に配信してブラウザで確かめる。
const { defineConfig } = require('@playwright/test');

// テストの中で作る日時(new Date(...))とブラウザの時刻を、どちらも日本時間にそろえる
process.env.TZ = 'Asia/Tokyo';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:8765',
    viewport: { width: 390, height: 844 }, // iPhone の画面幅
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'off',
  },
  webServer: {
    command: 'node tests/server.js',
    url: 'http://localhost:8765/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
