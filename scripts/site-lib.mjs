import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROMAN_TO_NUMBER = new Map([
  ["0", 0], ["O", 0], ["I", 1], ["II", 2], ["III", 3], ["IV", 4],
  ["V", 5], ["VI", 6], ["VII", 7], ["VIII", 8], ["IX", 9], ["X", 10],
  ["XI", 11], ["XII", 12], ["XIII", 13], ["XIV", 14], ["XV", 15],
  ["XVI", 16], ["XVII", 17], ["XVIII", 18], ["XIX", 19], ["XX", 20], ["XXI", 21]
]);

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function textProperty(property) {
  if (!property) return "";
  const items = property.rich_text ?? property.title ?? [];
  return items.map((item) => item.plain_text ?? item.text?.content ?? "").join("").trim();
}

export function selectProperty(property) {
  return property?.select?.name ?? property?.status?.name ?? "";
}

export function dateProperty(property) {
  return property?.date?.start?.slice(0, 10) ?? "";
}

export function urlProperty(property) {
  return property?.url ?? "";
}

export function parseCard(position, cardValue, orientation) {
  const raw = String(cardValue ?? "").trim();
  const match = raw.match(/^(.*?)\s*[（(]([IVXO0-9]+)[）)]/i);
  if (!match) throw new Error(`${position}カード「${raw}」から番号を判定できません。`);
  const key = match[2].toUpperCase();
  const number = /^\d+$/.test(key) ? Number(key) : ROMAN_TO_NUMBER.get(key);
  if (!Number.isInteger(number) || number < 0 || number > 21) {
    throw new Error(`${position}カード「${raw}」の番号が大アルカナ0〜21の範囲外です。`);
  }
  return {
    position,
    number: String(number).padStart(2, "0"),
    name: match[1].trim(),
    orientation: orientation || "正位置"
  };
}

function renderRichText(items = []) {
  return items.map((item) => {
    let value = escapeHtml(item.plain_text ?? item.text?.content ?? "").replaceAll("\n", "<br>");
    const href = item.href;
    if (href && /^https?:\/\//.test(href)) value = `<a href="${escapeHtml(href)}">${value}</a>`;
    if (item.annotations?.code) value = `<code>${value}</code>`;
    if (item.annotations?.bold) value = `<strong>${value}</strong>`;
    if (item.annotations?.italic) value = `<em>${value}</em>`;
    return value;
  }).join("");
}

function blockText(block) {
  return (block?.[block.type]?.rich_text ?? []).map((item) => item.plain_text ?? "").join("").trim();
}

function renderStoryBlock(block) {
  const richText = block?.[block.type]?.rich_text ?? [];
  const html = renderRichText(richText);
  if (block.type === "paragraph") return html ? `<p>${html}</p>` : "";
  if (block.type === "quote") return html ? `<blockquote>${html}</blockquote>` : "";
  if (block.type === "bulleted_list_item") return html ? `<li>${html}</li>` : "";
  if (block.type === "numbered_list_item") return html ? `<li>${html}</li>` : "";
  return "";
}

export function extractStoryHtml(blocks) {
  let insideStory = false;
  const output = [];
  let listType = null;

  const closeList = () => {
    if (listType) output.push(listType === "numbered_list_item" ? "</ol>" : "</ul>");
    listType = null;
  };

  for (const block of blocks) {
    const text = blockText(block);
    if (!insideStory) {
      if (block.type === "heading_2" && text === "短編小説") insideStory = true;
      continue;
    }
    if (block.type === "divider" || (block.type === "heading_2" && text.includes("制作記録"))) break;
    if (block.type === "paragraph" && /^[(（]約?[\d,，]+字[)）]$/.test(text)) continue;

    const isList = block.type === "bulleted_list_item" || block.type === "numbered_list_item";
    if (isList && listType !== block.type) {
      closeList();
      output.push(block.type === "numbered_list_item" ? "<ol>" : "<ul>");
      listType = block.type;
    } else if (!isList) {
      closeList();
    }
    const rendered = renderStoryBlock(block);
    if (rendered) output.push(rendered);
  }
  closeList();
  if (!insideStory || output.length === 0) throw new Error("Notion本文に「短編小説」見出しと公開可能な本文が必要です。");
  return output.join("");
}

export function buildStoryFromPage(page, blocks) {
  const props = page.properties ?? {};
  const title = textProperty(props["公開タイトル"]);
  const date = dateProperty(props["公開日"]);
  const target = selectProperty(props["公開先"]);
  if (!title) throw new Error(`${page.id}: 公開タイトルが空です。制作タイトルは代用しません。`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${title}: 公開日が必要です。`);
  if (target !== "月夜の短編集") throw new Error(`${title}: 公開先が月夜の短編集ではありません。`);

  const cards = [
    parseCard("過去", textProperty(props["過去カード"]), selectProperty(props["過去正逆"])),
    parseCard("現在", textProperty(props["現在カード"]), selectProperty(props["現在正逆"])),
    parseCard("未来", textProperty(props["未来カード"]), selectProperty(props["未来正逆"]))
  ];

  return {
    date,
    title,
    category: selectProperty(props["ジャンル"]) || "その他",
    path: `stories/${date}/`,
    notionPageId: page.id,
    notionLastEditedTime: page.last_edited_time,
    cards,
    storyHtml: extractStoryHtml(blocks),
    newsHeadline: textProperty(props["ニュース見出し"]),
    newsSummary: textProperty(props["ニュース概要"]),
    verification: textProperty(props["裏付け状況"]),
    person: textProperty(props["人物"]),
    personSetting: textProperty(props["人物設定"])
  };
}

// 同じ公開日の作品は stories/YYYY-MM-DD/、stories/YYYY-MM-DD-2/ … と連番にする。
// 1作目のURLは従来どおりなので、既存の公開URLは変わらない。
export function storySequence(storyPath = "") {
  const match = String(storyPath).match(/^stories\/\d{4}-\d{2}-\d{2}(?:-(\d+))?\/$/);
  return match?.[1] ? Number(match[1]) : 1;
}

export function storyPathFor(date, sequence) {
  return sequence > 1 ? `stories/${date}-${sequence}/` : `stories/${date}/`;
}

export function assignStoryPath(stories, story) {
  const existing = stories.find((item) => item.notionPageId === story.notionPageId);
  if (existing && existing.date === story.date) return existing.path;
  const used = new Set(stories
    .filter((item) => item.date === story.date && item.notionPageId !== story.notionPageId)
    .map((item) => item.path));
  let sequence = 1;
  while (used.has(storyPathFor(story.date, sequence))) sequence += 1;
  return storyPathFor(story.date, sequence);
}

// 古い順（公開日→同日内の公開順）。新しい順はこの逆。
export function compareStories(a, b) {
  return a.date.localeCompare(b.date) || storySequence(a.path) - storySequence(b.path);
}

export function renderStoryPage(story) {
  const dateLabel = story.date.replaceAll("-", ".");
  const cards = story.cards.map((card) => {
    const reversed = card.orientation === "逆位置" ? ' class="reversed"' : "";
    const alt = `${card.name}・${card.orientation}`;
    return `<figure><img${reversed} src="../../assets/tarot/${card.number}.svg" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(card.position)}　${escapeHtml(alt)}</figcaption></figure>`;
  }).join("");
  const cardItems = story.cards.map((card) => `<li>${escapeHtml(card.position)}：${escapeHtml(card.name)}（${escapeHtml(card.orientation)}）</li>`).join("");
  const news = [story.newsHeadline ? `題材は「${story.newsHeadline}」。` : "", story.newsSummary, story.verification].filter(Boolean).join(" ");
  const person = [story.person, story.personSetting].filter(Boolean).join("。 ");
  const noticeDate = `${story.date.slice(0, 4)}年${Number(story.date.slice(5, 7))}月${Number(story.date.slice(8, 10))}日`;
  const writingModeScript = `<script>(()=>{const prose=document.getElementById("story-body");const toggle=document.getElementById("writing-toggle");const hint=document.getElementById("writing-hint");if(!prose||!toggle||!hint)return;const storageKey="tsukiyo-writing-mode";const applyMode=(vertical,persist=false)=>{prose.classList.toggle("vertical",vertical);toggle.setAttribute("aria-pressed",String(vertical));toggle.textContent=vertical?"横書きに戻す":"縦書きで読む";hint.textContent=vertical?"右から左へ横に送って読みます。":"";prose.scrollLeft=0;if(persist){try{localStorage.setItem(storageKey,vertical?"vertical":"horizontal")}catch{}}};let vertical=false;try{vertical=localStorage.getItem(storageKey)==="vertical"}catch{}applyMode(vertical);toggle.addEventListener("click",()=>applyMode(!prose.classList.contains("vertical"),true))})();</script>`;

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(story.date)}のニュースと三枚の大アルカナから生まれた短編小説。"><title>${escapeHtml(story.title)}｜月夜の短編集</title><link rel="stylesheet" href="../../styles.css"></head><body><header class="shell site-head"><a class="brand" href="../../index.html">月夜の短編集</a><nav class="nav"><a href="../../archive-date.html">日付から</a><a href="../../archive-title.html">題名から</a></nav></header><main class="story"><header class="story-header"><p class="meta">${dateLabel} ／ ${escapeHtml(story.category)}</p><h1>${escapeHtml(story.title)}</h1></header><div class="deck">${cards}</div><div class="reading-controls" aria-label="本文の表示"><button type="button" class="writing-toggle" id="writing-toggle" aria-controls="story-body" aria-pressed="false">縦書きで読む</button><span class="writing-hint" id="writing-hint" role="status" aria-live="polite"></span></div><article class="prose" id="story-body" tabindex="0" aria-label="短編本文">${story.storyHtml}</article><details class="process"><summary>制作過程を読む</summary><div class="process-body"><h2>ニュースと選定</h2><p>${escapeHtml(news)}</p><h2>人物</h2><p>${escapeHtml(person)}</p><h2>三枚のカード</h2><ul>${cardItems}</ul><p class="notice">この物語は実在人物を描いたものではありません。ニュースは${noticeDate}時点の報道を起点にしており、制度変更を既定事実としていません。</p></div></details></main><footer class="footer"><div class="shell"><a href="../../index.html">トップへ戻る</a></div></footer>${writingModeScript}</body></html>\n`;
}

function storyRow(story, titleMode = false) {
  const label = titleMode ? Array.from(story.title)[0] : story.date.replaceAll("-", ".");
  return `<a class="story-row" href="${escapeHtml(story.path)}"><span class="date">${escapeHtml(label)}</span><span class="title">${escapeHtml(story.title)}</span><span class="arrow" aria-hidden="true">→</span></a>`;
}

export function renderIndexes(stories) {
  const newestFirst = [...stories].sort((a, b) => compareStories(b, a));
  const titleOrder = [...stories].sort((a, b) => a.title.localeCompare(b.title, "ja"));
  const latest = newestFirst[0];
  if (!latest) throw new Error("公開作品が1件もありません。");
  const heroCards = latest.cards.map((card) => `<img src="assets/tarot/${card.number}.svg" alt="${escapeHtml(card.name)}">`).join("");
  const recentRows = newestFirst.slice(0, 5).map((story) => storyRow(story)).join("");
  const index = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="ニュースと三枚の大アルカナから生まれる、短編小説の小さな書庫。"><title>月夜の短編集</title><link rel="stylesheet" href="styles.css"></head><body><header class="shell site-head"><a class="brand" href="index.html">月夜の短編集</a><nav class="nav" aria-label="主要ナビゲーション"><a href="archive-date.html">日付から</a><a href="archive-title.html">題名から</a><a href="${escapeHtml(latest.path)}">最新作</a></nav></header><main><section class="shell hero"><div><p class="eyebrow">News × Tarot × Short fiction</p><h1>現実の片隅に、<br>もうひとつの物語を。</h1><p class="lead">その日のニュースと三枚の大アルカナを手がかりに、一人の暮らしを描く短編小説。占いの答えではなく、考えるための物語です。</p><a class="cta" href="${escapeHtml(latest.path)}">最新作を読む</a></div><div class="card-fan" aria-label="最新作で引かれた三枚のカード">${heroCards}</div></section><section class="section"><div class="shell"><p class="label">Latest stories</p><h2>新しい物語</h2><div class="story-list">${recentRows}</div></div></section></main><footer class="footer"><div class="shell">© 月夜の短編集　原稿保管：Notion ／ 公開管理：GitHub</div></footer></body></html>\n`;
  const byDate = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>日付から｜月夜の短編集</title><link rel="stylesheet" href="styles.css"></head><body><header class="shell site-head"><a class="brand" href="index.html">月夜の短編集</a><nav class="nav"><a href="archive-date.html" aria-current="page">日付から</a><a href="archive-title.html">題名から</a></nav></header><main class="shell"><div class="archive-head"><p class="label">Archive by date</p><h1>日付から</h1></div><div class="story-list">${newestFirst.map((story) => storyRow(story)).join("")}</div></main><footer class="footer"><div class="shell">公開承認された作品の一覧です。</div></footer></body></html>\n`;
  const byTitle = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>題名から｜月夜の短編集</title><link rel="stylesheet" href="styles.css"></head><body><header class="shell site-head"><a class="brand" href="index.html">月夜の短編集</a><nav class="nav"><a href="archive-date.html">日付から</a><a href="archive-title.html" aria-current="page">題名から</a></nav></header><main class="shell"><div class="archive-head"><p class="label">Archive by title</p><h1>題名から</h1></div><div class="story-list">${titleOrder.map((story) => storyRow(story, true)).join("")}</div></main><footer class="footer"><div class="shell">五十音順の作品一覧です。</div></footer></body></html>\n`;
  return { index, byDate, byTitle };
}

export async function loadJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

export async function writeText(relativePath, content) {
  const destination = path.join(ROOT, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

