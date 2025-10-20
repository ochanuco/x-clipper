# Repository Guidelines

## プロジェクト構成とモジュール配置
- ブラウザ拡張のソースは `src/`、ビルド成果物は `dist/` に出力される。コンテンツスクリプト・サービスワーカー・オプション UI が中心。
- `public/` に manifest・オプション HTML・アイコンなど静的ファイル、`scripts/` にビルドスクリプトを配置。
- バックエンドは `server/` に配置し、`index.mjs` で Express API を提供。環境変数は `server/.env` で管理し `.env.example` を参考にする。
- 依存パッケージは単一の `package.json` で管理し、`pnpm` を利用する。ローカル環境では `pnpm install` のみで拡張とサーバー両方の依存が揃う。

## ビルド・テスト・開発コマンド
- `pnpm install` – 依存をインストール。lockfile の差分が出た場合は必ず実行する。
- `pnpm run build` – TypeScript をコンパイルして拡張の JS を `dist/` に生成。
- `pnpm run server` – Express バックエンドを起動。`server/.env` の内容が読み込まれる。
- `pnpm run typecheck` – TypeScript の型検証のみを実行する。

## コーディングスタイルと命名規則
- Node 20 + TypeScript を前提に、ES Modules と 2 スペースインデントを標準とする。
- インターフェースや型エイリアスは PascalCase (`ClipPayload`)、関数と変数は camelCase、不変の定数は `ALL_CAPS` を用いる。
- 現状 ESLint/Prettier 設定は未導入のため、フォーマットが気になる場合は手動で修正する。
- バックエンド側では環境変数を直接参照する。秘匿情報をリポジトリに含めないこと。

## テスト指針
- テスト基盤は未構築。実装追加時はユニットテスト導入を検討し、`pnpm run build` で最低限の検証を行う。
- バックエンドの外部リクエストは `fetch` を利用しているため、モックする場合は `undici` 等を活用する。

## コミットとプルリクエストの指針
- Conventional Commits (`feat:`、`fix:`、`chore:` など) を採用し、例: `feat: add markdown clipping pipeline`。
- 各 PR では関連 Issue へのリンク、アプローチの要約、UI が変わる場合のスクリーンショットや GIF を添付する。
- 1 PR の差分は 400 行以内を目安にし、大規模な変更はレビューしやすい単位に分割して段階的な展開方針も説明する。
