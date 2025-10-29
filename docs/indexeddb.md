# IndexedDB キャッシュ（実装ノート）

このドキュメントは `background.ts` に導入した IndexedDB キャッシュの設計と注意点をまとめます。

## 概要

- ダウンロードしたメディア（Blob）を IndexedDB に一時保存する仕組みを追加しました。
- 保存キーは自動生成される `fileName` を使用します。
- Notion へのアップロードが成功したら該当エントリを削除します。
- 保存/削除に失敗しても主要なアップロード処理は継続します（警告ログのみ）。

## 実装のポイント

- DB 名: `x-clipper-cache`
- ストア名: `assets`
- 保存されるオブジェクト例: `{ fileName, blob, meta, createdAt }`
- 公開 API（`background.ts` 内）:
  - `saveToCache({ fileName, blob, meta })`
  - `getFromCache(fileName)`
  - `deleteFromCache(fileName)`

## 現状の挙動

- `downloadAsset()` は Blob を取得後に `saveToCache()` を非同期で呼び出します（fire-and-forget）。
- `uploadAssetToNotion()` が成功すると `deleteFromCache()` を呼び出します。
- 20MB を超えるファイルは既存の方針通りアップロードをスキップします（`uploadAssetToNotion` は `null` を返します）。

## 検討すべき改善点（フォローアップ）

1. TTL と自動クリーンアップ: デフォルトで 7 日経過したキャッシュを削除するロジックを追加。
2. ストレージ制限: IndexedDB の使用量が増えないよう総容量制限や LRU の導入を検討。
3. ユーザ UI: オプション画面に「未送信メディア」の一覧表示と手動での再送信/削除操作を追加。
4. 大容量ファイル処理: 20MB 超のファイルに対しては分割アップロード、外部ストレージ、あるいはユーザへの案内などの代替フローを設計。

## デバッグ方法

- 開発環境: Chrome の DevTools -> Application -> IndexedDB を参照。
- `x-clipper-cache` 内の `assets` ストアを確認。

## 注意

- このキャッシュはユーザのブラウザ内にのみ存在します。秘匿情報や長期保存を想定したものではありません。

