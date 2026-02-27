# X Clipper

![](public/icons/x-clipper.svg)

Chrome 拡張機能「X Clipper」は、X（Twitter）の投稿詳細ページから表示名・ユーザー名・本文・投稿時刻・画像を抽出し、Notion にページを作成して保存します。

## 利用者向け

### 主な機能
- 拡張機能ボタン・右クリックメニュー・投稿内の「保存」ボタンから保存を実行できます。
- アバターと投稿画像を Notion に添付し、カバー画像/ページアイコンにも自動反映します。
- 画像添付に失敗した場合は、元 URL 添付またはブラウザへの保存に切り替えます。

### Chrome への読み込み手順
1. `pnpm install`
2. `pnpm run build`
3. `chrome://extensions/` を開く。
4. 右上で「デベロッパーモード」を有効化。
5. 「パッケージ化されていない拡張機能を読み込む」から `dist/` ディレクトリを選択。

### 使い方
1. X の投稿詳細ページを開く。
2. 次のいずれかから保存を開始する。
   - ツールバーの拡張機能ボタン
   - 右クリックメニュー「X Clipper で Notion に保存」
   - 投稿に挿入される丸形の「保存」ボタン
3. 保存完了後、Notion データベースにページが作成されることを確認する。

### Notion 連携の設定
オプションページで次の値を設定してください。

| 項目 | 説明 |
| --- | --- |
| Notion API キー | Notion の統合で発行したシークレット（`ntn_`）。 |
| Notion データベース | 「DB一覧を取得」から、Integration に共有済みの保存先データベースを選択。 |
| プロパティ名マッピング | 必要な場合のみ設定。通常は初期値のままで利用可能。 |

設定値は `chrome.storage.local` に保存され、拡張機能内でのみ利用されます。

## 開発者向け

### 前提条件
- Node.js 20 以上
- pnpm 9 系

### 開発コマンド
- `pnpm install` 依存関係をインストール
- `pnpm run build:icons` SVG アイコンを PNG に変換
- `pnpm run build` ローカル開発用マニフェストで拡張機能をビルドして `dist/` を生成
- `pnpm run build:dev` 開発環境用マニフェストで拡張機能をビルドして `dist/` を生成
- `pnpm run build:prod` 公開用マニフェストで拡張機能をビルドして `dist/` を生成
- `pnpm run typecheck` TypeScript 型チェック
- `pnpm test` Vitest（watch）
- `pnpm run test:unit` Vitest（単発）

### 実装メモ
- MV3 のサービスワーカー（`src/background.ts`）を中心に、Notion API と連携します。
- 静的ファイルは `public/`、ビルド成果物は `dist/` に配置されます。
