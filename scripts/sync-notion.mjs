import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, loadJson, writeText } from "./site-lib.mjs";
import { FatalSyncError, prepareSync } from "./sync-core.mjs";
import { createReport, writeReport } from "./sync-report.mjs";

const report = createReport();

async function loadConfig() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new FatalSyncError("CONFIG_INVALID", "NOTION_TOKEN が設定されていません。");
  let config;
  try {
    config = await loadJson("automation.config.json");
  } catch (error) {
    throw new FatalSyncError("CONFIG_INVALID", `automation.config.json を読めません: ${error.message}`, { cause: error });
  }
  for (const key of ["notionDataSourceId", "notionVersion", "publishTarget"]) {
    if (!config[key]) throw new FatalSyncError("CONFIG_INVALID", `automation.config.json に ${key} がありません。`);
  }
  return { token, config };
}

function notionClient({ token, config }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": config.notionVersion
  };
  return async function notionRequest(url, init = {}) {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Notion API ${response.status}: ${body.message ?? response.statusText}`);
    return body;
  };
}

async function queryApprovedPages(notionRequest, config) {
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

function blockFetcher(notionRequest) {
  return async function fetchBlocks(pageId) {
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
  };
}

async function readExisting(relativePath) {
  try {
    return await readFile(path.join(ROOT, relativePath), "utf8");
  } catch {
    return null;
  }
}

try {
  const { token, config } = await loadConfig();
  const notionRequest = notionClient({ token, config });

  let approvedPages;
  try {
    approvedPages = await queryApprovedPages(notionRequest, config);
  } catch (error) {
    throw new FatalSyncError("NOTION_FETCH_FAILED", `承認済み作品の一覧を取得できませんでした: ${error.message}`, { cause: error });
  }

  let currentStories;
  try {
    currentStories = await loadJson("content/stories.json");
  } catch (error) {
    throw new FatalSyncError("CONFIG_INVALID", `content/stories.json を読めません: ${error.message}`, { cause: error });
  }

  const result = await prepareSync({
    approvedPages,
    fetchBlocks: blockFetcher(notionRequest),
    currentStories,
    readExisting,
    publishTarget: config.publishTarget
  });

  // 全作品の検証と衝突確認が終わってから書き込む。
  for (const [relativePath, content] of result.writes) await writeText(relativePath, content);

  Object.assign(report, {
    status: result.status,
    candidates: result.candidates,
    prepared: result.prepared,
    held: result.held
  });
  console.log(`検証対象 ${result.candidates}件 ／ 公開候補 ${result.prepared.length}件 ／ 保留 ${result.held.length}件`);
  for (const item of result.held) console.warn(`保留: ${item.title ?? item.notionPageId} [${item.reason_code}] ${item.message}`);
} catch (error) {
  report.status = "fatal";
  report.fatal = {
    reason_code: error instanceof FatalSyncError ? error.code : "UNEXPECTED",
    message: error.message
  };
  console.error(`全体停止 [${report.fatal.reason_code}] ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await writeReport(report);
  } catch (error) {
    console.error(`同期レポートを書き出せませんでした: ${error.message}`);
    process.exitCode = 1;
  }
}
