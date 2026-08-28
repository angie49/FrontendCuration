// キーワードによるタグ付けと、雑多なフィードからフロントエンド記事だけを拾う判定

/** タグ名 → 判定に使う正規表現 */
const TAG_RULES = [
  ['CSS', /\b(css|scss|sass|tailwind|postcss|container quer|@layer|:has\(|subgrid|flexbox|grid layout|cascade)\b|カスケード|スタイル/i],
  ['JavaScript', /\b(javascript|js|ecmascript|es20\d\d|promise|async\b|closure|dom\b)\b/i],
  ['TypeScript', /\b(typescript|\bts\b|type[- ]safe|型)\b/i],
  ['フレームワーク', /\b(react|next\.?js|vue|nuxt|svelte|solidjs|astro|remix|angular|qwik|htmx|alpine\.js)\b/i],
  ['ブラウザ/仕様', /\b(chrome|safari|firefox|webkit|blink|w3c|whatwg|baseline|interop|spec|proposal|release notes)\b|仕様|ブラウザ|リリースノート/i],
  ['アクセシビリティ', /\b(accessib|a11y|aria|wcag|screen reader)\b|アクセシビリティ|スクリーンリーダ/i],
  ['パフォーマンス', /\b(performance|core web vitals|lcp|inp|cls\b|lighthouse|bundle size|lazy ?load|optimiz)\b|パフォーマンス|表示速度|軽量化/i],
  ['ツール/ビルド', /\b(vite|webpack|rollup|esbuild|turbopack|bun\b|deno|npm|pnpm|eslint|biome|prettier|monorepo|ci\/cd|github actions)\b|ビルド|ツール/i],
  ['アニメーション', /\b(animation|transition|view transition|scroll[- ]driven|motion|gsap|lottie|wa?api)\b|アニメーション|モーション/i],
  ['デザイン/UI', /\b(design system|ui\b|ux\b|figma|typography|layout|dark mode|color scheme)\b|デザイン|タイポグラフィ|配色/i],
  ['AI', /\b(ai\b|llm|copilot|claude|chatgpt|gpt-|cursor|mcp\b)\b|生成ai/i],
  ['フォーム/HTML', /\b(html|form control|<dialog|popover|input type|semantic)\b|フォーム|マークアップ/i],
];

/** はてブなど雑多なフィードから、フロントエンド系だけを残すための判定 */
const FRONTEND_HINT =
  /\b(css|html|javascript|typescript|react|vue|next\.?js|nuxt|svelte|astro|frontend|front-end|web ?vitals|browser|chrome|safari|webkit|a11y|accessib|tailwind|vite|web ?components|wasm|dom\b)\b|フロントエンド|マークアップ|ブラウザ|アクセシビリティ|コーディング|レスポンシブ|デザインシステム|ウェブ制作|Web制作/i;

/** 明らかにノイズなもの（求人・PR記事など）を落とす */
const NOISE = /(PR\s*[:：]|\[PR\]|求人|採用情報|スポンサー|sponsored)/i;

export function assignTags(item) {
  const haystack = `${item.title} ${item.excerpt} ${(item.feedCategories || []).join(' ')}`;
  const tags = [];
  for (const [tag, re] of TAG_RULES) {
    if (re.test(haystack)) tags.push(tag);
  }
  return tags.slice(0, 5);
}

export function isRelevant(item, source) {
  if (NOISE.test(item.title)) return false;
  // filter: "frontend" が指定されたソースだけ、内容でふるいにかける
  if (source?.filter === 'frontend') {
    return FRONTEND_HINT.test(`${item.title} ${item.excerpt}`);
  }
  return true;
}
