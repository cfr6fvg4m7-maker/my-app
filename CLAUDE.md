# このリポジトリでの作業ルール

## 公開(マージ)は Claude がやる
- 公開ブランチ(GitHub Pages)は `claude/manaba-task-pwa-728utb`(既定のブランチ。`main` はない)
- 変更したら: 作業ブランチに push → `claude/manaba-task-pwa-728utb` へのプルリクエストを作る
  → GitHub Actions の `test` がすべて成功したのを確認 → **Claude がそのままマージする**(持ち主の了承済み。毎回確認しなくてよい)
- テストが失敗したらマージしない。直して push し、成功してからマージする
- マージ後は「1〜2分待ってから、アプリを完全に終了して開き直す」と伝える

## アプリ
- ルート: manaba課題アプリ / `aki/`: 空き時間アプリ(詳しくは README.md)
- ファイルを変えたら、それぞれの `sw.js` の `CACHE` の番号を上げる
- テスト: `npx playwright test --trace off`
