import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT,
  buildStoryFromPage,
  loadJson,
  renderIndexes,
  renderStoryPage,
  selectProperty,
  writeText
} from "./site-lib.mjs";

const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("NOTION_TOKEN が設定されていません。");

const config = await loadJson("automation.config.json");
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "Notion-Version": config.notionVersion
};

async function notionRequest(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Notion API ${response.status}: ${body.message ?? response.statusText}`);
  return body;
}

async function queryApprovedPages() {
  const pages = [];
  let startCursor;
  do {
    const body = {
      page_size: 100,
      filter: {
        and: [
          { property: "公開状態", select: { equals: "公開承認" } },
          { property: "公開先", select: { equals: config.publishTarget } }
        ]
      }
    };
    if (startCursor) body.start_cursor = startCursor;
    const result = await notionRequest(`https://api.notion.com/v1/data_sources/${config.notionDataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    pages.push(...result.results);
    startCursor = result.has_more ? result.next_cursor : undefined;
  } while (startCursor);
  return pages;
}

async function fetchBlocks(pageId) {
  const blocks = [];
  let startCursor;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    url.searchParams.set("page_size", "100");
    if (startCursor) url.searchParams.set("start_cursor", startCursor);
    const result = await notionRequest(url);
    blocks.push(...result.results);
    startCursor = result.has_more ? result.next_cursor : undefined;
  } while (startCursor);
  return blocks;
}

const currentStories = await loadJson("content/stories.json");
const approvedPages = await queryApprovedPages();
if (approvedPages.length === 0) {
  console.log("公開承認された新しい作品はありません。");
  process.exit(0);
}

const nextStories = [...currentStories];
for (const page of approvedPages) {
  if (selectProperty(page.properties?.["公開先"]) !== config.publishTarget) continue;
  const blocks = await fetchBlocks(page.id);
  const story = buildStoryFromPage(page, blocks);
  const collision = nextStories.find((item) => item.date === story.date && item.notionPageId !== story.notionPageId);
  if (collision) throw new Error(`${story.date} は「${collision.title}」ですでに使用されています。公開日を変更してください。`);

  await writeText(`${story.path}index.html`, renderStoryPage(story));
  const publicRecord = {
    date: story.date,
    title: story.title,
    category: story.category,
    path: story.path,
    notionPageId: story.notionPageId,
    notionLastEditedTime: story.notionLastEditedTime,
    cards: story.cards
  };
  const existingIndex = nextStories.findIndex((item) => item.notionPageId === story.notionPageId);
  if (existingIndex >= 0) nextStories[existingIndex] = publicRecord;
  else nextStories.push(publicRecord);
}

nextStories.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ja"));
await writeFile(path.join(ROOT, "content/stories.json"), `${JSON.stringify(nextStories, null, 2)}\n`, "utf8");
const indexes = renderIndexes(nextStories);
await writeText("index.html", indexes.index);
await writeText("archive-date.html", indexes.byDate);
await writeText("archive-title.html", indexes.byTitle);
console.log(`${approvedPages.length}件の公開承認作品をサイトへ反映しました。`);

