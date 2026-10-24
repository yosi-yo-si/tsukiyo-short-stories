import test from "node:test";
import assert from "node:assert/strict";
import { renderStoryPage } from "../scripts/site-lib.mjs";
import { FatalSyncError, prepareSync } from "../scripts/sync-core.mjs";

const rich = (content) => [{ plain_text: content, text: { content }, annotations: {} }];
const body = [
  { type: "heading_2", heading_2: { rich_text: rich("短編小説") } },
  { type: "paragraph", paragraph: { rich_text: rich("本文") } }
];

function page(id, { title = `作品${id}`, date = "2026-10-24", card = "力(VIII)", edited = "2026-10-24T00:00:00Z" } = {}) {
  return {
    id,
    last_edited_time: edited,
    properties: {
      "公開タイトル": { rich_text: rich(title) },
      "公開日": { date: { start: date } },
      "公開先": { select: { name: "月夜の短編集" } },
      "ジャンル": { select: { name: "社会" } },
      "過去カード": { rich_text: rich(card) },
      "現在カード": { rich_text: rich("吊るされた男(XII)") },
      "未来カード": { rich_text: rich("世界(XXI)") }
    }
  };
}

const cards = [
  { position: "過去", number: "08", name: "力", orientation: "正位置" },
  { position: "現在", number: "12", name: "吊るされた男", orientation: "正位置" },
  { position: "未来", number: "21", name: "世界", orientation: "正位置" }
];
const published = {
  date: "2026-10-24", title: "見送る手", category: "社会", path: "stories/2026-10-24/",
  notionPageId: "old", notionLastEditedTime: "2026-10-24T00:00:00Z", cards
};

function run(approvedPages, { currentStories = [published], files = {}, fetchBlocks } = {}) {
  return prepareSync({
    approvedPages,
    fetchBlocks: fetchBlocks ?? (async () => body),
    currentStories,
    readExisting: async (p) => files[p] ?? null,
    publishTarget: "月夜の短編集"
  });
}

test("正常作品と保留作品が混在しても、正常作品は公開候補になる", async () => {
  const result = await run([page("a"), page("b", { title: "" }), page("c", { card: "謎" })]);
  assert.equal(result.status, "prepared");
  assert.equal(result.candidates, 3);
  assert.deepEqual(result.prepared, [{ notionPageId: "a", title: "作品a", path: "stories/2026-10-24-2/", kind: "new" }]);
  assert.deepEqual(result.held.map((h) => h.reason_code), ["EMPTY_TITLE", "INVALID_CARD"]);
  assert.ok(result.writes.has("stories/2026-10-24-2/index.html"));
  assert.ok(![...result.writes.keys()].some((p) => p.includes("-3/")));
});

test("保留だけなら held_only で、何も書かない", async () => {
  const result = await run([page("b", { title: "" })]);
  assert.equal(result.status, "held_only");
  assert.equal(result.writes.size, 0);
});

test("承認作品がなければ nothing", async () => {
  const result = await run([]);
  assert.equal(result.status, "nothing");
  assert.equal(result.candidates, 0);
});

test("公開済み作品の更新が不正なら、直前の公開版を残す", async () => {
  const result = await run([page("old", { title: "見送る手", card: "謎" })]);
  assert.equal(result.status, "held_only");
  assert.equal(result.writes.size, 0);
  assert.equal(result.nextStories[0].title, "見送る手");
});

test("公開日を変えた公開済み作品はURLを維持して更新扱い", async () => {
  const result = await run([page("old", { title: "見送る手（改）", date: "2026-10-30" })]);
  assert.deepEqual(result.prepared, [{ notionPageId: "old", title: "見送る手（改）", path: "stories/2026-10-24/", kind: "updated" }]);
});

const publishedHtml = renderStoryPage({
  ...published, storyHtml: "<p>本文</p>", newsHeadline: "", newsSummary: "", verification: "", person: "", personSetting: ""
});

test("内容も編集日時も変わらない作品は公開候補に含めないが、検証対象には数える", async () => {
  const result = await run([page("old", { title: "見送る手" })], {
    files: { "stories/2026-10-24/index.html": publishedHtml }
  });
  assert.equal(result.status, "nothing");
  assert.equal(result.candidates, 1);
  assert.equal(result.writes.size, 0);
});

test("本文が同じで編集日時だけ進んだ作品は、記録だけ更新して公開済みにできるようにする", async () => {
  const result = await run([page("old", { title: "見送る手", edited: "2026-10-25T00:00:00Z" })], {
    files: { "stories/2026-10-24/index.html": publishedHtml }
  });
  assert.equal(result.status, "prepared");
  assert.equal(result.prepared[0].kind, "updated");
  assert.ok(!result.writes.has("stories/2026-10-24/index.html"));
  assert.equal(result.nextStories[0].notionLastEditedTime, "2026-10-25T00:00:00Z");
});

test("公開日を移した作品の元URLは、同じ日付の新作に再利用しない", async () => {
  const moved = { ...published, date: "2026-10-30" };
  const result = await run([page("a", { date: "2026-10-24" })], { currentStories: [moved] });
  assert.equal(result.prepared[0].path, "stories/2026-10-24-2/");
});

test("本文の取得失敗は全体停止", async () => {
  await assert.rejects(
    run([page("a")], { fetchBlocks: async () => { throw new Error("timeout"); } }),
    (e) => e instanceof FatalSyncError && e.code === "NOTION_FETCH_FAILED"
  );
});

test("URLの重複は全体停止", async () => {
  const broken = [published, { ...published, notionPageId: "dup", title: "別作品" }];
  await assert.rejects(run([page("a")], { currentStories: broken }), (e) => e.code === "PATH_COLLISION");
});
