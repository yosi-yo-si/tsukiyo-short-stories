import { loadJson, selectProperty, urlProperty } from "./site-lib.mjs";

const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("NOTION_TOKEN が設定されていません。");
const config = await loadJson("automation.config.json");
const stories = await loadJson("content/stories.json");
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "Notion-Version": config.notionVersion
};

async function notionRequest(url, init = {}) {
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Notion API ${response.status}: ${body.message ?? response.statusText}`);
  return body;
}

for (const story of stories) {
  if (!story.notionPageId) continue;
  const expectedUrl = `${config.publicBaseUrl}/${story.path}`;
  const page = await notionRequest(`https://api.notion.com/v1/pages/${story.notionPageId}`);
  const status = selectProperty(page.properties?.["公開状態"]);
  const currentUrl = urlProperty(page.properties?.["公開URL"]);
  if (status === "公開済み" && currentUrl === expectedUrl) continue;
  await notionRequest(`https://api.notion.com/v1/pages/${story.notionPageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        "公開状態": { select: { name: "公開済み" } },
        "公開URL": { url: expectedUrl }
      }
    })
  });
  console.log(`Notionを公開済みに更新: ${story.title}`);
}

