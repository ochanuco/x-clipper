# Repository Guidelines

## プロジェクト構成とモジュール配置
- ブラウザ拡張のソースは `src/`、ビルド成果物は `dist/` に出力される。コンテンツスクリプト・サービスワーカー・オプション UI が中心。
- `public/` に manifest・オプション HTML・アイコンなど静的ファイル、`scripts/` にビルドスクリプトを配置。
- ブラウザ拡張が Notion へ直接アクセスするため、追加のバックエンドは不要。Direct Upload API を利用する。
- 依存パッケージは単一の `package.json` で管理し、`pnpm` を利用する。ローカル環境では `pnpm install` のみで拡張とサーバー両方の依存が揃う。

## ビルド・テスト・開発コマンド
- `pnpm install` – 依存をインストール。lockfile の差分が出た場合は必ず実行する。
- `pnpm run build:icons` – SVG アイコンを PNG 形式に変換して `public/` に生成。
- `pnpm run build` – アイコン変換後、TypeScript をコンパイルして拡張の JS を `dist/` に生成。
- `pnpm run typecheck` – TypeScript の型検証のみを実行する。
- `pnpm test` – Vitest によるユニットテストを実行。
- `pnpm test:e2e` – Playwright による E2E テストを実行。
- サーバー起動コマンドは存在しない。ビルドと型チェック、テストのみ。

## コーディングスタイルと命名規則
- Node 20 + TypeScript を前提に、ES Modules と 2 スペースインデントを標準とする。
- インターフェースや型エイリアスは PascalCase (`ClipPayload`)、関数と変数は camelCase、不変の定数は `ALL_CAPS` を用いる。
- 現状 ESLint/Prettier 設定は未導入のため、フォーマットが気になる場合は手動で修正する。
- Notion の統合キーなど秘匿情報は拡張のオプション画面で入力し、`chrome.storage.local` にのみ保存する。リポジトリへ含めないこと。

## テスト指針
- **ユニットテスト**: Vitest + jsdom 環境で実装。`tests/e2e/` 以外の `.test.ts` または `.spec.ts` ファイルが対象。
- **E2E テスト**: Playwright で実装。`tests/e2e/` 配下に配置し、実際のブラウザ拡張の動作を検証する。
- **CI/CD**: GitHub Actions で PR 作成時に E2E テストが自動実行される (`ubuntu-slim` 環境)。
- 外部リクエストのモックが必要な場合は、Vitest の標準モック機能や `msw` 等を活用する。

## コミットとプルリクエストの指針
- Conventional Commits (`feat:`、`fix:`、`chore:` など) を採用し、コミットメッセージは日本語で簡潔に記述する。例: `feat: Markdown クリッピング機能を追加`。
- 各 PR では関連 Issue へのリンク、アプローチの要約、UI が変わる場合のスクリーンショットや GIF を添付する。
- 1 PR の差分は 400 行以内を目安にし、大規模な変更はレビューしやすい単位に分割して段階的な展開方針も説明する。
