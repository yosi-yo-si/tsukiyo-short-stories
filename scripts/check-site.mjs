import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, loadJson } from "./site-lib.mjs";

const stories = await loadJson("content/stories.json");
const errors = [];
const forbidden = ["ChatGPT版", "Notion制作ログでの原題", "書き方の判断", "原稿と制作記録はNotion"];

for (const story of stories) {
  if (!story.title || !story.date || !story.path || !story.notionPageId) errors.push(`作品メタデータ不足: ${JSON.stringify(story)}`);
  const pagePath = path.join(ROOT, story.path, "index.html");
  try {
    const html = await readFile(pagePath, "utf8");
    if (!html.includes(`<h1>${story.title}</h1>`)) errors.push(`${story.path}: 公開タイトルが一致しません。`);
    for (const phrase of forbidden) if (html.includes(phrase)) errors.push(`${story.path}: 公開禁止文言「${phrase}」が含まれています。`);
    const notice = html.indexOf("この物語は実在人物を描いたものではありません。");
    const cards = html.indexOf("<h2>三枚のカード</h2>");
    if (notice < cards) errors.push(`${story.path}: 注意書きは制作過程の末尾に置いてください。`);
    for (const card of story.cards) await access(path.join(ROOT, `assets/tarot/${card.number}.svg`));
  } catch (error) {
    errors.push(`${story.path}: ${error.message}`);
  }
}

for (const page of ["archive-date.html", "archive-title.html"]) {
  const html = await readFile(path.join(ROOT, page), "utf8");
  for (const story of stories) {
    if (!html.includes(story.path) || !html.includes(story.title)) errors.push(`${page}: ${story.title}へのリンクがありません。`);
  }
}

const indexHtml = await readFile(path.join(ROOT, "index.html"), "utf8");
const recentStories = [...stories].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
for (const story of recentStories) {
  if (!indexHtml.includes(story.path) || !indexHtml.includes(story.title)) errors.push(`index.html: ${story.title}へのリンクがありません。`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`${stories.length}作品と一覧ページを検証しました。`);

