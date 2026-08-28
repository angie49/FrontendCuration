// フィードの取得とパース（RSS 2.0 / Atom / RDF に対応）
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  processEntities: true,
  // タグが1件しかない場合でも配列で受け取りたいものを指定
  isArray: (name) => ['item', 'entry', 'link', 'category'].includes(name),
});

const UA =
  'frontend-radar/1.0 (+personal curation bot; https://github.com/)';

/** 指定URLを取得。失敗時はリトライしてから諦める。 */
async function fetchWithRetry(url, { timeoutMs = 20000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** <title> などが文字列だったりオブジェクトだったりするのを吸収 */
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') return text(node['#text'] ?? '');
  return '';
}

/** Atom の <link rel="alternate" href="..."> を優先して取り出す */
function pickLink(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    const alt = node.find((l) => (l?.['@_rel'] ?? 'alternate') === 'alternate' && l?.['@_href']);
    if (alt) return alt['@_href'];
    const first = node.find((l) => typeof l === 'string' || l?.['@_href']);
    return typeof first === 'string' ? first : first?.['@_href'] ?? '';
  }
  if (typeof node === 'object') return node['@_href'] ?? text(node);
  return '';
}

/** HTMLタグを落として、要約向けのプレーンテキストにする */
export function toPlainText(html, maxLength = 220) {
  if (!html) return '';
  const stripped = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= maxLength) return stripped;
  return stripped.slice(0, maxLength).trimEnd() + '…';
}

function parseDate(...candidates) {
  for (const candidate of candidates) {
    const raw = text(candidate);
    if (!raw) continue;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url.trim());
    // 追跡パラメータを落として重複判定を安定させる
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return url.trim();
  }
}

/** 1つのソースを取得して、正規化済みの記事配列を返す */
export async function fetchSource(source) {
  const xml = await fetchWithRetry(source.url);
  const doc = parser.parse(xml);

  const channel = doc?.rss?.channel ?? doc?.['rdf:RDF'] ?? doc?.feed ?? null;
  if (!channel) throw new Error('フィードの構造を判別できませんでした');

  const rawItems = channel.item ?? channel.entry ?? doc?.feed?.entry ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items
    .map((item) => {
      const link = normalizeUrl(pickLink(item.link) || text(item.guid) || text(item.id));
      const title = toPlainText(text(item.title), 300);
      if (!link || !title) return null;

      const body =
        text(item['content:encoded']) ||
        text(item.description) ||
        text(item.summary) ||
        text(item.content) ||
        '';

      const categories = []
        .concat(item.category ?? [])
        .map((c) => (typeof c === 'string' ? c : c?.['@_term'] ?? text(c)))
        .filter(Boolean)
        .slice(0, 8);

      return {
        id: `${source.id}:${link}`,
        sourceId: source.id,
        sourceName: source.name,
        category: source.category,
        lang: source.lang,
        weight: source.weight ?? 1,
        title,
        url: link,
        publishedAt: parseDate(item.pubDate, item.published, item.updated, item['dc:date'], item.date),
        excerpt: toPlainText(body),
        feedCategories: categories,
      };
    })
    .filter(Boolean);
}
