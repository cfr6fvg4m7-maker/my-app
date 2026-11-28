# このリポジトリでの作業ルール

## 公開(マージ)は自動
- 公開ブランチ(GitHub Pages)は `claude/manaba-task-pwa-728utb`(既定のブランチ。`main` はない)
- 変更したら: 手元で `npx playwright test --trace off` が通るのを確かめる → 作業ブランチ(`claude/...`)に push
  → `claude/manaba-task-pwa-728utb` へのプルリクエストを作る
- あとは GitHub Actions(`.github/workflows/test.yml`)が自動で行う:
  1. `test` ジョブ: 全テスト
  2. `automerge` ジョブ: テストに合格したらマージし、公開ページ(GitHub Pages)のファイルが新しくなったかを最大10分確かめる
- Claude はプルリクエストを見守り(subscribe_pr_activity)、テストか `automerge` が失敗したら原因を直して push する。
  `automerge` が動かなかったとき(マージされずに残ったとき)だけ、テスト合格を確かめてから Claude がマージする(持ち主の了承済み)
- テストに失敗したものはマージしない
- 公開されたら「1〜2分待ってから、アプリを完全に終了して開き直す」と伝える

## アプリ
- ルート: manaba課題アプリ / `aki/`: 空き時間アプリ(詳しくは README.md)
- ファイルを変えたら、それぞれの `sw.js` の `CACHE` の番号を上げる
- テスト: `npx playwright test --trace off`
