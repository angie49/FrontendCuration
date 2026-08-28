#!/usr/bin/env node
// フィード収集 → 蓄積 → （任意で）AI要約 → 静的HTML生成
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSource } from './lib/feed.mjs';
import { assignTags, isRelevant } from './lib/tags.mjs';
import { enrich } from './lib/enrich.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 環境変数で差し替え可能（テストや別プロファイル用）
const SOURCES_FILE = process.env.RADAR_SOURCES || path.join(ROOT, 'sources.json');
const ARCHIVE_FILE = process.env.RADAR_ARCHIVE || path.join(ROOT, 'data', 'archive.json');
const TEMPLATE_FILE = path.join(ROOT, 'scripts', 'template.html');
const OUT_DIR = process.env.RADAR_OUT || path.join(ROOT, 'site');

// 何日分を保持するか / 上限件数（HTMLが重くなりすぎないように）
const RETAIN_DAYS = Number(process.env.RADAR_RETAIN_DAYS || 120);
const MAX_ITEMS = Number(process.env.RADAR_MAX_ITEMS || 900);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function main() {
  const { sources } = await readJson(SOURCES_FILE, { sources: [] });
  const enabled = sources.filter((s) => s.enabled !== false);
  console.log(`▶ ${enabled.length} ソースを取得します`);

  const results = await Promise.allSettled(
    enabled.map(async (source) => {
      const items = await fetchSource(source);
      return { source, items };
    })
  );

  const fetched = [];
  const report = [];
  results.forEach((result, index) => {
    const source = enabled[index];
    if (result.status === 'rejected') {
      report.push({ id: source.id, name: source.name, ok: false, count: 0, error: String(result.reason?.message || result.reason) });
      console.warn(`  ✗ ${source.name}: ${result.reason?.message || result.reason}`);
      return;
    }
    const kept = result.value.items
      .filter((item) => isRelevant(item, source))
      .map((item) => ({ ...item, tags: assignTags(item) }));
    fetched.push(...kept);
    report.push({ id: source.id, name: source.name, ok: true, count: kept.length });
    console.log(`  ✓ ${source.name}: ${kept.length} 件`);
  });

  // ---- 既存アーカイブとマージ（要約済みの記事は再生成しない） ----
  const archive = await readJson(ARCHIVE_FILE, { items: [] });
  const byId = new Map();
  for (const item of archive.items) byId.set(item.id, item);

  let added = 0;
  for (const item of fetched) {
    const existing = byId.get(item.id);
    if (existing) {
      // タイトルや日付が更新されることがあるので反映しつつ、要約は残す
      byId.set(item.id, { ...existing, ...item, summary: existing.summary, score: existing.score, firstSeenAt: existing.firstSeenAt });
    } else {
      byId.set(item.id, { ...item, firstSeenAt: new Date().toISOString() });
      added++;
    }
  }

  // 公開日が無い記事は初回取得日で代用
  let items = [...byId.values()].map((item) => ({
    ...item,
    publishedAt: item.publishedAt || item.firstSeenAt || null,
  }));

  // 保持期間で間引き
  const cutoff = Date.now() - RETAIN_DAYS * 86400000;
  items = items.filter((item) => {
    const t = new Date(item.publishedAt || item.firstSeenAt || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });

  // 同じURLが複数ソースから来た場合は1件にまとめる
  const seenUrl = new Map();
  for (const item of items.sort((a, b) => (b.weight || 1) - (a.weight || 1))) {
    if (!seenUrl.has(item.url)) seenUrl.set(item.url, item);
  }
  items = [...seenUrl.values()];

  items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  items = items.slice(0, MAX_ITEMS);

  console.log(`▶ 新規 ${added} 件 / 保持 ${items.length} 件`);

  // ---- 任意：AI要約とスコア付け ----
  const enrichResult = await enrich(items);

  // ---- 保存 ----
  await fs.mkdir(path.dirname(ARCHIVE_FILE), { recursive: true });
  await fs.writeFile(ARCHIVE_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 0));

  // ---- HTML生成 ----
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceCount: report.filter((r) => r.ok).length,
      itemCount: items.length,
      aiEnabled: !enrichResult.skipped,
      report,
    },
    items: items.map((item) => ({
      id: item.id,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      category: item.category,
      weight: item.weight,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      excerpt: item.excerpt,
      summary: item.summary,
      score: item.score,
      tags: item.tags,
    })),
  };

  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const template = await fs.readFile(TEMPLATE_FILE, 'utf8');
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'index.html'), template.replace('__DATA__', json));
  await fs.writeFile(path.join(OUT_DIR, '.nojekyll'), '');
  await fs.writeFile(path.join(OUT_DIR, 'feed.json'), JSON.stringify(payload, null, 2));

  const failed = report.filter((r) => !r.ok);
  console.log(`▶ site/index.html を生成しました（${items.length} 件）`);
  if (failed.length) console.log(`▶ 取得に失敗したソース: ${failed.map((f) => f.name).join(', ')}`);

  // 全滅したときだけ異常終了させる（1〜2本落ちても止めない）
  if (report.length && failed.length === report.length) {
    console.error('すべてのソースの取得に失敗しました');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
