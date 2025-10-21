# X Clipper

Chrome 拡張機能「X Clipper」は、X（Twitter）の投稿詳細ページから表示名・ユーザー名・本文・投稿時刻・画像を抽出し、バックエンド経由で Notion に保存することに特化しています。バックエンドは取得した画像を自身のストレージ（`server/uploads`）へ保存し、その公開 URL を Notion に渡すことで、元の投稿が消えても Notion 上で閲覧できるようにしています。Notion が画像へアクセスできるよう、バックエンドはインターネットから到達可能なホストへ配置する前提です。

## 前提条件
- Node.js 20 以上
- pnpm 9 系
- Notion で発行したシークレットキー（`secret_` / `ntn_`）と対象データベース ID
- バックエンド用の永続ホスティング環境、またはローカルで常時稼働させるマシン

## セットアップ
```bash
pnpm install
```

## バックエンドの起動
1. `server/.env.example` を複製して `server/.env` を作成し、値を設定
   ```env
   NOTION_API_KEY=secret_xxx
   NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   NOTION_VERSION=2025-09-03            # Notion API version (required for file uploads)
   X_CLIPPER_TOKEN=local-dev-token     # 任意、空でも可
   PORT=8787
   ASSET_BASE_URL=https://your-domain.example.com   # 画像を配信する公開 URL
   ```
2. バックエンドを起動
```bash
   pnpm run server
```

バックエンドは `POST /clip` を受け取り、X から渡された画像をダウンロード → `server/uploads` に保存 → 公開 URL を Notion に渡してページを作成します。`X_CLIPPER_TOKEN` を設定すると Bearer 認証が有効化されます（互換性のため `CLIP_NOTION_TOKEN` も読み取ります）。`ASSET_BASE_URL` には Notion からアクセス可能なベース URL（例: `https://clip.example.com`）を指定してください。ローカル開発時はデフォルトで `http://localhost:8787` を利用します。

Notion への画像添付は Direct Upload API（`/v1/file_uploads` → `/v1/file_uploads/{id}/send`）を利用しています。アップロードしたファイルは 1 時間以内にページへアタッチする必要があるため、サーバー内でページ作成まで一気通貫で処理しています。

## 拡張機能のビルド
```bash
pnpm run build
```
`dist/` に manifest・サービスワーカー・コンテンツスクリプト・オプションページが生成されます。

## Chrome への読み込み手順
1. `chrome://extensions/` を開く。
2. 右上で「デベロッパーモード」を有効化。
3. 「パッケージ化されていない拡張機能を読み込む」から `dist/` ディレクトリを選択。

## 拡張機能の設定
1. 拡張機能のオプションページ（`chrome://extensions/` → X Clipper → 詳細 → 拡張機能オプション）を開く。
2. バックエンドの `POST /clip` エンドポイント URL と、必要に応じて Bearer トークンを登録。
3. Notion データベースのプロパティ名（Title・Screen Name・Username など）を入力して保存。

## 使い方
- X の投稿詳細ページを開いた状態で、ツールバーの拡張機能ボタンまたは右クリックメニュー「この投稿を Notion に保存」を選択。
- 拡張機能が投稿データを抽出してバックエンドへ送信し、バックエンドが Notion にページを作成します。
- 投稿本文は段落ブロックとして、画像はバックエンドが配信する URL を参照する `external` ブロックとして追加されます。1 枚目がカバー、プロフィール画像がページアイコンになります。

## 開発メモ
- TypeScript を使用し、ビルドは `pnpm exec tsc` で行います。ウォッチやホットリロードが必要な場合は Vite などの導入を検討してください。
- バックエンドは Express 製のミニマルな API です。必要に応じて認証・ロギング・永続化を拡張してください。
- 自動テストは未整備です。Jest + MSW などで拡張／バックエンド双方のテストを追加する余地があります。
