# Repository Guidelines

## プロジェクト構成とモジュール配置
- 本番コードは `src/` に置き、ドメイン別に (`src/clip`、`src/notion`、`src/ui`) 分割して横断的なヘルパーを再利用しやすくする。
- 設定・起動スクリプトは `scripts/` にまとめ、秘密情報はリポジトリに含めず `.env.local` でローカル管理する。
- 自動テストやフィクスチャは `tests/` に配置し、`src/` のフォルダ構造を鏡写しにして特定しやすくする。
- サンプルページ、JSON フィクスチャ、スクリーンショットなどのアセットは `assets/` に整理し、同期しやすい軽量フォーマットを選ぶ。

## ビルド・テスト・開発コマンド
- `npm install` – 依存関係をインストール。lockfile が更新されたら必ず再実行する。
- `npm run dev` – ローカルのクリッパー環境を立ち上げ、モックした Notion エンドポイントに対して反復開発する。
- `npm run build` – TypeScript を `dist/` にコンパイルし、ブラウザ拡張の成果物をバンドルする。
- `npm test` – ユニットおよび結合テスト一式を実行。CI も同じコマンドを利用する。
- `npm run lint` – ESLint と Prettier を実行して、コミット前にスタイルを検証・整形する。

## コーディングスタイルと命名規則
- Node 20 + TypeScript を前提に、ES Modules と 2 スペースインデントを標準とする。
- インターフェースや型エイリアスは PascalCase (`ClipPayload`)、関数と変数は camelCase、不変の定数は `ALL_CAPS` を用いる。
- `npm run lint` を定期的に実行するか、ワークスペース設定で ESLint/Prettier の自動整形を有効化してフォーマットを保つ。
- Notion API の共通処理は `src/notion/client.ts` に集約し、フェッチロジックの重複を避ける。

## テスト指針
- テストは `tests/<domain>/<feature>.test.ts` に配置し、対象の振る舞いに合わせたファイル名 (`clip-article.test.ts`) を付ける。
- Jest + Testing Library を基本とし、外部 HTTP 呼び出しは MSW でモックして安定性を確保する。
- 新しい Notion ブロック変換には最低 1 件の結合テストを追加し、`npm test -- --coverage` でステートメントカバレッジ 80% 以上を維持する。

## コミットとプルリクエストの指針
- Conventional Commits (`feat:`、`fix:`、`chore:` など) を採用し、例: `feat: add markdown clipping pipeline`。
- 各 PR では関連 Issue へのリンク、アプローチの要約、UI が変わる場合のスクリーンショットや GIF を添付する。
- 1 PR の差分は 400 行以内を目安にし、大規模な変更はレビューしやすい単位に分割して段階的な展開方針も説明する。
