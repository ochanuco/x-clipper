# X Parser Contract

`src/domain/x/parser.ts` を変更するときの契約メモ。X の DOM は変動しやすいため、見た目を単純化した実装変更で回帰しやすいポイントをここに固定する。

## 優先順位

本文中のリンク抽出は次の優先順位を守ること。

1. `title` / `data-expanded-url` / `data-full-url` / `aria-label` など、アンカーや子要素に展開URLがあればそれを使う
2. 展開属性がなくても、可視テキストが十分に復元可能なURLなら可視テキストを使う
3. 上のどちらも無理なら `t.co` の `href` を保持する

この順序を崩すと、属性が落ちた投稿で `t.co` がそのまま保存されたり、逆に省略URLを誤って確定URLとして扱ったりする。

## 可視URLの扱い

`normalizeVisibleUrlText()` 相当の判定は保守的に見えて重要。次のケースは落とさないこと。

- `https://gallery.example.net/posts/12345678…`
  - 長い数値IDが末尾にある可視URLは採用する
- `https://video.example.org/watch?v=abcd1234&si=token…`
  - クエリ付きの可視URLは採用する
- `https://example.com/articles/slugvalue01…`
  - 安定したslugが末尾にある可視URLは採用する

次のケースは採用しないこと。

- `gallery.example.net/posts/12345...`
  - 属性も補助情報も無い短い省略URLは、確定できないので `t.co` を残す
- `@sample_user`
  - メンションをURL扱いしない
- `http://`
  - protocolだけの表示は、それ単体ではURLとして確定しない

## 実運用で確認済みの制約

- X のアンカーから `title` や `data-expanded-url` が消えている投稿がある
- その場合でも、可視テキストには `https://example.com/...…` のような省略URLが出ることがある
- MV3 service worker からの `fetch('https://t.co/...')` は、環境によって最終URLへ解決できず `200 / url=t.co` のまま返ることがある
- そのため、`t.co` 展開は background 側だけに依存せず parser 側でも成立している必要がある

## 変更時のルール

- `extractExpandedAnchorUrl()` と `normalizeVisibleUrlText()` はセットで考える
- 単純化のために「省略URLは全部捨てる」「可視URLは全部採用する」のどちらにも寄せない
- 実投稿で不具合が出たら、まず最小DOMを `parser.test.ts` に追加してから修正する
- live URL を直に覚え込んだテストは避け、`example.com` 系のダミーURLへマスクする

## 最低限の回帰例

- 属性あり:
  - 入力: `<a href="https://t.co/abc123" title="https://example.com/p/1">example.com/p/1...</a>`
  - 期待: `https://example.com/p/1`
- 属性なし + 可視slugあり:
  - 入力: `<a href="https://t.co/abc123">https://example.com/articles/slugvalue01…</a>`
  - 期待: `https://example.com/articles/slugvalue01`
- 属性なし + 不十分な可視URL:
  - 入力: `<a href="https://t.co/abc123">example.com/p/12345...</a>`
  - 期待: `https://t.co/abc123`

