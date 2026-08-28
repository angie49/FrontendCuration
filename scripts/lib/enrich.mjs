// 任意機能：Claude API で日本語の要約と「実務での重要度」スコアを付ける。
// ANTHROPIC_API_KEY が無ければ何もせずに素通りする（APIキー無しでもシステムは動く）。

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.RADAR_MODEL || 'claude-sonnet-4-5';
const BATCH_SIZE = Number(process.env.RADAR_BATCH_SIZE || 10);
const MAX_ITEMS = Number(process.env.RADAR_MAX_ENRICH || 60);

const SYSTEM_PROMPT = `あなたは日本のWeb制作会社に勤めるフロントエンド開発者のための情報キュレーターです。
渡された記事リストそれぞれについて、次を日本語で返してください。

- summary: 記事の要点を日本語で1〜2文（最大90文字程度）。英語記事も日本語にする。タイトルの言い換えではなく「何が新しい/何が分かるのか」を書く。
- score: 受託のWeb制作（HTML/CSS/JSの実装、ブラウザ互換、アクセシビリティ、表示速度）の実務にどれくらい効くかを1〜5で採点。
  5 = 明日の案件で使える具体的な実装知識やブラウザ対応の変化
  3 = 知っておくと役立つが今すぐは使わない
  1 = 話題性のみ、または実務との関連が薄い

出力は必ず JSON 配列のみ。前後に説明文やコードフェンスを付けないこと。
形式: [{"i": 0, "summary": "...", "score": 4}, ...]`;

async function callApi(apiKey, batch) {
  const payload = batch.map((item, i) => ({
    i,
    title: item.title,
    source: item.sourceName,
    excerpt: (item.excerpt || '').slice(0, 400),
  }));

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload, null, 1) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  return JSON.parse(raw);
}

/**
 * summary が未設定の記事に要約とスコアを付ける（破壊的更新）。
 * 失敗してもビルド全体は止めず、素のフィード表示にフォールバックする。
 */
export async function enrich(items) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('· AI要約: ANTHROPIC_API_KEY が無いのでスキップ（フィードそのままで表示します）');
    return { enriched: 0, skipped: true };
  }

  const targets = items.filter((item) => !item.summary).slice(0, MAX_ITEMS);
  if (targets.length === 0) {
    console.log('· AI要約: 新規記事なし');
    return { enriched: 0, skipped: false };
  }

  let enriched = 0;
  for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
    const batch = targets.slice(offset, offset + BATCH_SIZE);
    try {
      const results = await callApi(apiKey, batch);
      for (const result of results) {
        const item = batch[result.i];
        if (!item) continue;
        if (typeof result.summary === 'string' && result.summary.trim()) {
          item.summary = result.summary.trim();
        }
        const score = Number(result.score);
        if (Number.isFinite(score)) item.score = Math.min(5, Math.max(1, Math.round(score)));
        enriched++;
      }
      console.log(`· AI要約: ${Math.min(offset + BATCH_SIZE, targets.length)}/${targets.length} 件`);
    } catch (err) {
      console.warn(`· AI要約でエラー（このバッチはスキップ）: ${err.message}`);
    }
  }

  return { enriched, skipped: false };
}
