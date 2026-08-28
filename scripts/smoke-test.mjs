#!/usr/bin/env node
// ネットワークに出ずに、取得〜パース〜タグ付け〜HTML生成までを検証するテスト。
// ローカルにダミーのフィードサーバーを立てて build.mjs を通す。
//   node scripts/smoke-test.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toUTCString();
const isoAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Fixture Blog</title>
  <item>
    <title>Container queries land in every browser</title>
    <link>https://example.com/container-queries?utm_source=rss</link>
    <pubDate>${daysAgo(1)}</pubDate>
    <description>&lt;p&gt;A look at &lt;strong&gt;CSS&lt;/strong&gt; container queries and how the cascade handles them.&lt;/p&gt;</description>
    <category>CSS</category>
  </item>
  <item>
    <title>Speeding up INP with a smaller bundle</title>
    <link>https://example.com/inp-performance</link>
    <pubDate>${daysAgo(5)}</pubDate>
    <content:encoded>&lt;p&gt;Core Web Vitals, Lighthouse and bundle size tips using Vite.&lt;/p&gt;</content:encoded>
  </item>
  <item>
    <title>【PR】採用情報のお知らせ</title>
    <link>https://example.com/pr-noise</link>
    <pubDate>${daysAgo(2)}</pubDate>
    <description>ノイズ記事</description>
  </item>
  <item>
    <title>Ancient post that should be pruned</title>
    <link>https://example.com/old</link>
    <pubDate>${daysAgo(400)}</pubDate>
    <description>too old</description>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Fixture Atom</title>
  <entry>
    <title>Reactのアクセシビリティ対応をやり直した話</title>
    <link rel="alternate" href="https://example.com/a11y-react"/>
    <id>tag:example.com,2026:a11y-react</id>
    <published>${isoAgo(3)}</published>
    <summary>ariaとスクリーンリーダーの検証をやり直しました。</summary>
  </entry>
  <entry>
    <title>Duplicate across feeds</title>
    <link rel="alternate" href="https://example.com/container-queries"/>
    <id>tag:example.com,2026:dup</id>
    <updated>${isoAgo(1)}</updated>
    <content type="html">&lt;p&gt;same URL as the RSS one&lt;/p&gt;</content>
  </entry>
</feed>`;

const NOISY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Mixed</title>
  <item><title>Vue 4のリリース候補が出た</title><link>https://example.com/vue4</link><pubDate>${daysAgo(1)}</pubDate><description>フロントエンドの話題</description></item>
  <item><title>今日のランチ事情について</title><link>https://example.com/lunch</link><pubDate>${daysAgo(1)}</pubDate><description>まったく関係のない記事</description></item>
</channel></rss>`;

const routes = { '/rss.xml': RSS, '/atom.xml': ATOM, '/noisy.xml': NOISY };

const server = http.createServer((req, res) => {
  const body = routes[req.url];
  if (!body) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
  res.end(body);
});

function assert(condition, label) {
  if (condition) { console.log(`  ✓ ${label}`); return true; }
  console.error(`  ✗ ${label}`);
  process.exitCode = 1;
  return false;
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-test-'));
const sourcesFile = path.join(tmp, 'sources.json');
await fs.writeFile(sourcesFile, JSON.stringify({
  sources: [
    { id: 'fx-rss', name: 'Fixture Blog', url: `${base}/rss.xml`, category: 'overseas', lang: 'en', weight: 1.5 },
    { id: 'fx-atom', name: 'Fixture Atom', url: `${base}/atom.xml`, category: 'japan', lang: 'ja', weight: 1 },
    { id: 'fx-noisy', name: 'Mixed Feed', url: `${base}/noisy.xml`, category: 'japan', lang: 'ja', weight: 1, filter: 'frontend' },
    { id: 'fx-dead', name: 'Dead Feed', url: `${base}/missing.xml`, category: 'spec', lang: 'en', weight: 1 },
  ],
}));

console.log('▶ smoke test 開始');
const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
  env: {
    ...process.env,
    RADAR_SOURCES: sourcesFile,
    RADAR_ARCHIVE: path.join(tmp, 'archive.json'),
    RADAR_OUT: path.join(tmp, 'site'),
    ANTHROPIC_API_KEY: '',
  },
  stdio: 'inherit',
});
const code = await new Promise((resolve) => child.on('exit', resolve));
server.close();

console.log('\n▶ 検証');
assert(code === 0, '1本落ちてもビルドは成功する');

const out = JSON.parse(await fs.readFile(path.join(tmp, 'site', 'feed.json'), 'utf8'));
const html = await fs.readFile(path.join(tmp, 'site', 'index.html'), 'utf8');
const titles = out.items.map((i) => i.title);
const byTitle = (t) => out.items.find((i) => i.title === t);

assert(titles.includes('Container queries land in every browser'), 'RSSをパースできる');
assert(titles.includes('Reactのアクセシビリティ対応をやり直した話'), 'Atomをパースできる');
assert(!titles.includes('【PR】採用情報のお知らせ'), 'PR/求人ノイズを除外する');
assert(!titles.includes('Ancient post that should be pruned'), '保持期間外の古い記事を落とす');
assert(titles.includes('Vue 4のリリース候補が出た'), 'filter:frontend でも関連記事は残る');
assert(!titles.includes('今日のランチ事情について'), 'filter:frontend で無関係な記事を落とす');
assert(!titles.includes('Duplicate across feeds'), '同一URLの重複を1件にまとめる');
assert(byTitle('Container queries land in every browser').url === 'https://example.com/container-queries', 'utm_ パラメータを除去する');
assert((byTitle('Container queries land in every browser').tags || []).includes('CSS'), 'CSSタグが付く');
assert((byTitle('Speeding up INP with a smaller bundle').tags || []).includes('パフォーマンス'), 'パフォーマンスタグが付く');
assert((byTitle('Reactのアクセシビリティ対応をやり直した話').tags || []).includes('アクセシビリティ'), 'アクセシビリティタグが付く');
assert(byTitle('Container queries land in every browser').excerpt.includes('container queries'), 'HTMLタグを剥がした抜粋を作る');
assert(out.meta.sourceCount === 3, '成功したソース数を記録する');
assert(out.meta.report.some((r) => !r.ok && r.name === 'Dead Feed'), '失敗したソースを記録する');
assert(!html.includes('__DATA__'), 'テンプレートにデータが埋め込まれている');
assert(html.includes('radar-data'), 'データ用のscriptタグがある');
assert(!/<script id="radar-data"[^>]*>[^]*?<\/script>/.exec(html)[0].slice(60, -10).includes('</script'), 'JSON内に</script>が混入していない');

// 2回目のビルドで要約が保持され、重複が増えないこと
const first = out.items.length;
const archivePath = path.join(tmp, 'archive.json');
const archive = JSON.parse(await fs.readFile(archivePath, 'utf8'));
archive.items[0].summary = 'AIの要約テキスト';
archive.items[0].score = 4;
await fs.writeFile(archivePath, JSON.stringify(archive));

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const child2 = spawn(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], {
  env: { ...process.env, RADAR_SOURCES: sourcesFile, RADAR_ARCHIVE: archivePath, RADAR_OUT: path.join(tmp, 'site'), ANTHROPIC_API_KEY: '' },
  stdio: 'ignore',
});
await new Promise((resolve) => child2.on('exit', resolve));
server.close();

const out2 = JSON.parse(await fs.readFile(path.join(tmp, 'site', 'feed.json'), 'utf8'));
assert(out2.items.length === first, '再実行しても件数が増えない（重複しない）');
assert(out2.items.some((i) => i.summary === 'AIの要約テキスト' && i.score === 4), '既存のAI要約が再実行で保持される');

await fs.rm(tmp, { recursive: true, force: true });
console.log(process.exitCode ? '\n✗ 失敗あり' : '\n✓ すべて通過');
