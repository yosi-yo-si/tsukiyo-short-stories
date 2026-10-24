import test from "node:test";
import assert from "node:assert/strict";
import { assignStoryPath, buildStoryFromPage, compareStories, extractStoryHtml, parseCard, renderStoryPage, storySequence } from "../scripts/site-lib.mjs";

const rich = (content) => [{ plain_text: content, text: { content }, annotations: {} }];

test("カード名から大アルカナ番号を抽出する", () => {
  assert.deepEqual(parseCard("未来", "世界(XXI)", "正位置"), {
    position: "未来", number: "21", name: "世界", orientation: "正位置"
  });
});

test("短編本文だけを抽出する", () => {
  const blocks = [
    { type: "heading_2", heading_2: { rich_text: rich("短編小説") } },
    { type: "paragraph", paragraph: { rich_text: rich("公開する本文") } },
    { type: "paragraph", paragraph: { rich_text: rich("（約1,500字）") } },
    { type: "divider", divider: {} },
    { type: "paragraph", paragraph: { rich_text: rich("内部メモ") } }
  ];
  assert.equal(extractStoryHtml(blocks), "<p>公開する本文</p>");
});

test("公開タイトルだけを使用し、注意書きを末尾に置く", () => {
  const page = {
    id: "page-id",
    last_edited_time: "2026-10-24T00:00:00Z",
    properties: {
      "題名": { title: rich("内部制作タイトル") },
      "公開タイトル": { rich_text: rich("公開する題名") },
      "公開日": { date: { start: "2026-10-24" } },
      "公開先": { select: { name: "月夜の短編集" } },
      "ジャンル": { select: { name: "社会" } },
      "過去カード": { rich_text: rich("力(VIII)") },
      "過去正逆": { select: { name: "正位置" } },
      "現在カード": { rich_text: rich("吊るされた男(XII)") },
      "現在正逆": { select: { name: "正位置" } },
      "未来カード": { rich_text: rich("世界(XXI)") },
      "未来正逆": { select: { name: "正位置" } },
      "ニュース見出し": { rich_text: rich("見出し") },
      "ニュース概要": { rich_text: rich("概要") },
      "裏付け状況": { rich_text: rich("確認状況") },
      "人物": { rich_text: rich("人物") },
      "人物設定": { rich_text: rich("設定") }
    }
  };
  const blocks = [
    { type: "heading_2", heading_2: { rich_text: rich("短編小説") } },
    { type: "paragraph", paragraph: { rich_text: rich("本文") } },
    { type: "divider", divider: {} }
  ];
  const html = renderStoryPage(buildStoryFromPage(page, blocks));
  assert.match(html, /<h1>公開する題名<\/h1>/);
  assert.match(html, /id="writing-toggle"/);
  assert.match(html, /縦書きで読む/);
  assert.match(html, /id="story-body"/);
  assert.match(html, /tsukiyo-writing-mode/);
  assert.doesNotMatch(html, /内部制作タイトル/);
  assert.ok(html.indexOf("この物語は実在人物") > html.indexOf("<h2>三枚のカード</h2>"));
});


test("同じ公開日の作品には連番URLを割り当て、既存URLは変えない", () => {
  const stories = [
    { date: "2026-10-24", title: "見送る手", path: "stories/2026-10-24/", notionPageId: "a" }
  ];
  assert.equal(assignStoryPath(stories, { date: "2026-10-24", notionPageId: "b" }), "stories/2026-10-24-2/");
  assert.equal(assignStoryPath(stories, { date: "2026-10-24", notionPageId: "a" }), "stories/2026-10-24/");
  assert.equal(assignStoryPath(stories, { date: "2026-10-25", notionPageId: "c" }), "stories/2026-10-25/");
  const withSecond = [...stories, { date: "2026-10-24", path: "stories/2026-10-24-2/", notionPageId: "b" }];
  assert.equal(assignStoryPath(withSecond, { date: "2026-10-24", notionPageId: "b" }), "stories/2026-10-24-2/");
  assert.equal(assignStoryPath(withSecond, { date: "2026-10-24", notionPageId: "d" }), "stories/2026-10-24-3/");
});

test("一覧は公開日、同日内は公開順で並べる", () => {
  const stories = [
    { date: "2026-10-24", title: "あ", path: "stories/2026-10-24-2/" },
    { date: "2026-10-25", title: "う", path: "stories/2026-10-25/" },
    { date: "2026-10-24", title: "ん", path: "stories/2026-10-24/" }
  ];
  assert.deepEqual([...stories].sort(compareStories).map((s) => s.path),
    ["stories/2026-10-24/", "stories/2026-10-24-2/", "stories/2026-10-25/"]);
  assert.equal(storySequence("stories/2026-10-24-12/"), 12);
});
