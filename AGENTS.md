# Agent Notes

## Purpose
- README の再掲ではなく、この repo で実装時に踏み外しやすい判断だけを書く。

## Guardrails
- パッケージ管理と実行は `pnpm` を使う。
- このリポジトリはブラウザ拡張のみ。秘匿情報はリポジトリに置かず、`chrome.storage.local` 前提で扱う。
- テストや fixture に live URL、実在ハンドル、実在サービス固有の slug を直接残さない。`example.com` やダミー値へマスクする。

## Fragile Areas
- `src/domain/x/parser.ts` のリンク抽出は壊れやすい。`title` / `data-expanded-url` 系、可視URL復元、`t.co` fallback の優先順位を単純化しない。
- `src/domain/x/parser.ts` を触る前に `docs/x-parser-contract.md` を確認する。
- `src/options.ts` の DB schema 取得と property mapping は連動している。片方だけ単純化しない。
- `src/background.ts` の保存フローは、抽出、`t.co` 正規化、Notion properties 構築の順序を崩さない。

## Verification
- X 抽出ロジックを触ったら `src/domain/x/parser.test.ts` を更新または確認する。
- Notion properties、settings、options を触ったら対応する unit test を更新する。
- 最低でも `pnpm run typecheck` と `pnpm run test:unit` を回す。
- X 抽出や保存導線の境界をまたぐ変更では `pnpm run test:e2e` まで回す。

## Delivery
- コミットは Conventional Commits を使い、日本語で簡潔に書く。
- PR は小さく保ち、壊れやすい仕様を変える場合は根拠となる fixture か test を先に追加する。
