# X Clipper

![](public/icons/x-clipper.svg)

Chrome 拡張機能「X Clipper」は、X（Twitter）の投稿詳細ページから表示名・ユーザー名・本文・投稿時刻・画像を抽出し、Notion の Direct Upload API を使ってページを直接生成します。バックエンドは不要で、ダウンロードした画像は IndexedDB に一時保存したうえで `file_upload` としてアップロードし、失敗時は元 URL での添付かブラウザのダウンロードに自動フォールバックします。

主な特徴:
- 拡張機能ボタン・右クリックメニューに加え、各投稿に挿入される「保存」ボタンからも保存を実行できます。
- アバターと最大 4 枚の投稿画像を Direct Upload し、カバー画像/ページアイコンに自動で割り当てます。
- 未送信メディアは IndexedDB にキャッシュされ、オプションページから再送信/削除できます（7 日超はサービスワーカーが自動クリーンアップ）。

## 前提条件
- Node.js 20 以上
- pnpm 9 系
- Notion で発行したシークレットキー（`secret_` / `ntn_`）と保存先データベース ID

## セットアップ
```bash
pnpm install
pnpm run build
```
`dist/` に manifest・サービスワーカー・コンテンツスクリプト・オプションページが生成されます。

## Notion 連携の設定
オプションページで以下の値を入力してください。

| 項目 | 説明 |
| --- | --- |
| Notion API キー | Notion の統合で発行したシークレット（`secret_` / `ntn_`）。ユーザー自身が入力します。 |
| Notion データベース ID | 32 文字の ID、または Notion データベース URL に含まれる UUID。ハイフン付きでも可。 |
| Notion API バージョン | Direct Upload が利用できるバージョン（推奨: `2025-09-03`）。 |
| プロパティ名マッピング | Title・Screen Name・Username・Tweet URL・Posted At の各プロパティ名。データベース構成に合わせて変更します。 |

設定値は `chrome.storage.local` に保存され、ブラウザ内でのみ使用されます（暗号化は行われないため個人利用を想定しています）。

## Chrome への読み込み手順
1. `chrome://extensions/` を開く。
2. 右上で「デベロッパーモード」を有効化。
3. 「パッケージ化されていない拡張機能を読み込む」から `dist/` ディレクトリを選択。

## 使い方
- X の投稿詳細ページを開き、以下のいずれかから保存を開始します。
  - ツールバーの拡張機能ボタン
  - 右クリックメニュー「X Clipper で Notion に保存」
  - 投稿に挿入される丸形の「保存」ボタン
- 拡張機能が投稿本文と画像を取得し、`https://api.notion.com/v1/file_uploads` → `/file_uploads/{id}/send` で画像を Direct Upload した後、指定データベースにページを作成します。
- 画像は `file_upload` ブロックとして添付されます（1 枚目をカバー、プロフィール画像をページアイコンに利用）。20MB 超やアップロード失敗時は `external` ブロックまたはブラウザのダウンロードに自動フォールバックします。

## キャッシュと再送信
- ダウンロードしたメディアは IndexedDB（`x-clipper-cache/assets`）にキャッシュされます。
- オプションページの「未送信メディア」一覧から再送信や削除が可能です。
- サービスワーカー起動時および 1 日ごとに 7 日以上前のキャッシュを自動削除します。

## 仕組み
- 拡張機能のサービスワーカーが X 画像 CDN（`*.twimg.com` など）から画像を取得し、ブラウザメモリに保持します。
- Notion Direct Upload API でファイルをアップロードした後にページを作成し、アップロード ID を `file_upload` として添付します。添付はアップロード後 1 時間以内に実施する必要があるため、処理は即座に完結します。

## E2E テスト（オフライン）
- Playwright で MV3 拡張を読み込み、保存済みの X HTML とモック済み Notion API で最小ハッピーパスを検証します。
- 依存ブラウザの初回セットアップ: `pnpm exec playwright install chromium`
- 実行コマンド: `pnpm run test:e2e`
  - コマンド内で `pnpm run build` → `playwright test -c tests/e2e/playwright.config.ts` を順に実行します。
  - 失敗時は `.playwright-output/` にスクリーンショット・動画・trace が保存されます。

## 開発メモ
- TypeScript を使用し、ビルドは `pnpm run build` で行います（アイコン変換 → esbuild の順に実行）。
- 型チェック: `pnpm run typecheck`
- ユニットテスト: `pnpm test`
- Notion API・X CDN にアクセスせずに検証できる Playwright E2E を `tests/e2e` 以下に追加しました。
