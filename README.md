# Frontend Radar

フロントエンド（HTML / CSS / JS）の最新情報を毎日自動で集めて、1ページで読むための個人用キュレーションシステム。

GitHub Actions が1日1回フィードを巡回して静的HTMLを生成し、GitHub Pages に公開します。サーバー不要・無料枠で完結します。

---

## できること

- 28ソース（海外ブログ / 日本語コミュニティ / 仕様・リリース）を毎日 JST 8:00 に巡回
- カテゴリ・タグ・ソース・期間・全文検索で絞り込み
- 既読 / ★あとで読む をブラウザに保存（キーボード操作対応）
- ダークモード対応、スマホでも読める
- **任意**: Claude API を繋ぐと、英語記事も含めて日本語の要約と「実務での重要度」スコアが付く

### AI要約について（今回の想定）

回答が保留だったので、**AI要約は「オフでも完全に動く／APIキーを入れた瞬間に有効になる」** 設計にしました。

- `ANTHROPIC_API_KEY` を設定しない → フィードの抜粋をそのまま表示。コストゼロ。
- `ANTHROPIC_API_KEY` を設定する → 新着記事だけに日本語要約＋1〜5のスコアが付き、「重要度順」で並べ替えできる。一度付けた要約は `data/archive.json` に残るので、同じ記事に二重課金されません。

まずはキー無しで運用して、物足りなければ後から足す、で大丈夫です。

---

## セットアップ

### 1. リポジトリを作る

```bash
cd /Users/crefla/Sites/_tools   # 置き場所はどこでもOK
# 展開したフォルダに移動してから
git init
git add -A
git commit -m "init: frontend radar"
gh repo create frontend-radar --private --source=. --push
```

`gh` を使わない場合は、GitHub 上で空のリポジトリを作って `git remote add origin ...` → `git push -u origin main`。

> **プライベートリポジトリでも GitHub Pages を使いたい場合**、無料プランでは公開できません。
> リポジトリを Public にするか（コードは公開されますが、中身はフィードのリンク集です）、
> Pages を使わずに `npm run build` でローカルに `site/index.html` を作って開く運用でもかまいません。

### 2. GitHub Pages を有効にする

リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更。

### 3. 初回実行

**Actions タブ → Curate → Run workflow** を押す。2〜3分で終わります。
完了すると `https://<ユーザー名>.github.io/frontend-radar/` で読めるようになります。

以降は毎日 JST 8:00 に自動で更新されます。

### 4.（任意）AI要約を有効にする

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic Console で発行したAPIキー |

キーはリポジトリには一切書きません。ワークフローが環境変数として読み込むだけです。

モデルを変えたいときは、ワークフローの `env:` に `RADAR_MODEL: claude-haiku-4-5` のように足してください（安いモデルにするとコストが下がります）。モデルIDが古くて404になる場合もここで直せます。

---

## ソースを増やす・減らす

`sources.json` を編集して push するだけです。push すると自動でビルドが走ります。

```jsonc
{
  "id": "my-blog",          // 一意なID（英数字）
  "name": "表示名",
  "url": "https://example.com/feed",
  "category": "japan",      // overseas / japan / spec
  "lang": "ja",
  "weight": 1.2,            // 重要度順の並びで効く下駄。標準は1.0
  "filter": "frontend",     // 任意。雑多なフィードからフロントエンド記事だけ拾う
  "enabled": false          // 任意。一時的に止めたいとき
}
```

### 現在のソース一覧

**海外（11）** CSS-Tricks / Smashing Magazine / web.dev / Chrome for Developers / MDN Blog / Josh W. Comeau / Bram.us / Ahmad Shadeed / Mozilla Hacks / Frontend Focus / JavaScript Weekly

**日本語（10）** コリス / ICS MEDIA / Zenn（frontend・css・javascript）/ Qiita（CSS・JavaScript）/ はてブ テクノロジー / 池田泰延 Zenn / TAKLOG

**仕様・リリース（7）** WebKit / Chrome Releases / W3C News / Node.js Blog / GitHub Changelog / V8 Blog / WHATWG Blog

### Xアカウントの扱い

指定いただいた4アカウントは X に RSS が無いため、**同じ人・同じ組織が書いている一次ソースのフィード**に置き換えています。

| Xアカウント | 代わりに購読しているフィード |
| --- | --- |
| @colisscom | コリス本体 `https://coliss.com/feed` |
| @icsweb | ICS MEDIA `https://ics.media/feed/atom.xml` |
| @tonkotsuboy_com | ICS MEDIA ＋ 本人のZenn |
| @tak_dcxi | 個人ブログ TAKLOG `https://www.tak-dcxi.com/rss.xml` |

X の投稿そのものを取り込みたい場合は X API の有料プランが要ります。実質的な記事はほぼ上記フィードに流れてくるので、まずはこれで足りるはずです。

なお **V8 Blog / WHATWG Blog / TAKLOG は本家の更新自体が止まりぎみ**（最終更新が1年以上前）です。動いてはいるので入れてありますが、うるさければ `"enabled": false` にしてください。

---

## ローカルで動かす

```bash
npm install
npm run build      # site/index.html を生成
open site/index.html
```

APIキーを使いたいときは `ANTHROPIC_API_KEY=sk-... npm run build`。

### テスト

```bash
node scripts/smoke-test.mjs
```

ネットワークに出ずに、ダミーフィードを立てて取得〜パース〜重複排除〜HTML生成までを検証します。ソース定義やタグのルールをいじったあとに走らせてください。

---

## ファイル構成

```
sources.json              購読するフィードの定義（ここだけ触れば運用できる）
scripts/
  build.mjs               収集→蓄積→要約→HTML生成の本体
  template.html           閲覧画面のテンプレート（CSS/JSも同梱）
  smoke-test.mjs          ネットワーク不要のテスト
  lib/feed.mjs            RSS/Atom/RDF の取得とパース
  lib/tags.mjs            タグ付けとノイズ除去のルール
  lib/enrich.mjs          Claude API での日本語要約とスコア付け（任意）
data/archive.json         蓄積された記事（Actionsが自動コミット）
site/                     生成物。Pagesに配信される（gitignore済み）
.github/workflows/curate.yml
```

## 調整できるところ

| 環境変数 | 既定 | 意味 |
| --- | --- | --- |
| `RADAR_RETAIN_DAYS` | 120 | 何日分の記事を保持するか |
| `RADAR_MAX_ITEMS` | 900 | HTMLに載せる最大件数 |
| `RADAR_MAX_ENRICH` | 60 | 1回の実行でAI要約する上限件数（コスト上限） |
| `RADAR_MODEL` | claude-sonnet-4-5 | 要約に使うモデル |
| `RADAR_BATCH_SIZE` | 10 | 1リクエストにまとめる記事数 |

実行時刻は `.github/workflows/curate.yml` の `cron: '0 23 * * *'`（UTC）を変更してください。JST = UTC+9 です。

## つまずいたら

- **Pagesが404** — Settings → Pages の Source が「GitHub Actions」になっているか確認。
- **一部のソースだけ取れない** — Actionsのログに `✗ ソース名: HTTP 403` のように出ます。1〜2本落ちてもビルドは止まりません。恒常的に落ちるものは `enabled: false` に。
- **archive.json のコミットで失敗する** — Settings → Actions → General → Workflow permissions を「Read and write permissions」に。
- **記事が0件** — 期間フィルタが「30日」になっています。フィード側の更新が少ない時期は「全部」に切り替えてください。
- **既読が消えた** — 既読と★はブラウザの localStorage に入るので、別のブラウザ・別端末とは共有されません。
