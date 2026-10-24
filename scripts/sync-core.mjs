import {
  StoryValidationError,
  assignStoryPath,
  buildStoryFromPage,
  compareStories,
  renderIndexes,
  renderReadingPage,
  renderStoryPage,
  selectProperty,
  textProperty
} from "./site-lib.mjs";

// 全体を止めるエラー。作品単位の問題（StoryValidationError）とは区別する。
export class FatalSyncError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "FatalSyncError";
    this.code = code;
  }
}

function publicRecord(story) {
  return {
    date: story.date,
    title: story.title,
    category: story.category,
    path: story.path,
    notionPageId: story.notionPageId,
    notionLastEditedTime: story.notionLastEditedTime,
    cards: story.cards,
    // 記録ページのない作品は従来どおりの形のまま残す。
    ...(story.reading ? { hasReading: true } : {})
  };
}

function sameContent(a, b) {
  if (!a || !b) return false;
  const strip = ({ notionLastEditedTime, ...rest }) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * 承認済みページから公開候補を組み立てる。ファイルには書かず、書き込む内容を返す。
 * 途中で全体停止になった場合は何も書かれないので、公開済み版はそのまま残る。
 */
export async function prepareSync({ approvedPages, fetchBlocks, currentStories, readExisting, publishTarget }) {
  const nextStories = currentStories.map((story) => ({ ...story }));
  const writes = new Map();
  const prepared = [];
  const held = [];
  let candidates = 0;

  for (const page of approvedPages) {
    if (selectProperty(page.properties?.["公開先"]) !== publishTarget) continue;
    candidates += 1;

    let blocks;
    try {
      blocks = await fetchBlocks(page.id);
    } catch (error) {
      throw new FatalSyncError("NOTION_FETCH_FAILED", `本文を取得できませんでした（${page.id}）: ${error.message}`, { cause: error });
    }

    let story;
    try {
      story = buildStoryFromPage(page, blocks);
    } catch (error) {
      if (!(error instanceof StoryValidationError)) throw error;
      // 保留：HTMLも一覧も書かない。公開済み作品なら直前の公開版が残る。
      held.push({
        notionPageId: page.id,
        title: textProperty(page.properties?.["公開タイトル"]) || null,
        reason_code: error.code,
        message: error.message
      });
      continue;
    }

    story.path = assignStoryPath(nextStories, story);
    const html = renderStoryPage(story);
    const record = publicRecord(story);
    const existingIndex = nextStories.findIndex((item) => item.notionPageId === story.notionPageId);
    const existing = existingIndex >= 0 ? nextStories[existingIndex] : null;
    const readingPath = `${story.path}reading/index.html`;
    const readingHtml = story.reading ? renderReadingPage(story) : null;
    const existingHtml = await readExisting(`${story.path}index.html`);
    const existingReadingHtml = readingHtml ? await readExisting(readingPath) : null;
    const contentUnchanged = existingHtml === html && existingReadingHtml === readingHtml && sameContent(existing, record);
    if (contentUnchanged && existing.notionLastEditedTime === record.notionLastEditedTime) continue;

    // 本文が同じでも編集日時が進んでいれば記録だけ更新する。
    // これを怠ると mark-published が「未反映の変更あり」と判断し、公開済みにできなくなる。
    if (!contentUnchanged) {
      writes.set(`${story.path}index.html`, html);
      if (readingHtml) writes.set(readingPath, readingHtml);
    }
    if (existing) nextStories[existingIndex] = record;
    else nextStories.push(record);
    prepared.push({ notionPageId: story.notionPageId, title: story.title, path: story.path, kind: existing ? "updated" : "new" });
  }

  const seen = new Map();
  for (const story of nextStories) {
    if (seen.has(story.path)) {
      throw new FatalSyncError("PATH_COLLISION", `${story.path} が「${seen.get(story.path)}」と「${story.title}」で重複しています。`);
    }
    seen.set(story.path, story.title);
  }

  nextStories.sort(compareStories);
  if (prepared.length > 0) {
    const indexes = renderIndexes(nextStories);
    writes.set("content/stories.json", `${JSON.stringify(nextStories, null, 2)}\n`);
    writes.set("index.html", indexes.index);
    writes.set("archive-date.html", indexes.byDate);
    writes.set("archive-title.html", indexes.byTitle);
  }

  const status = prepared.length > 0 ? "prepared" : held.length > 0 ? "held_only" : "nothing";
  return { status, candidates, prepared, held, writes, nextStories };
}
