import test from "node:test";
import assert from "node:assert/strict";
import { StoryValidationError, assignStoryPath, buildStoryFromPage, compareStories, extractStoryHtml, parseCard, renderReadingPage, renderStoryPage, storySequence } from "../scripts/site-lib.mjs";

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
  // 公開日が変わっても、割り当て済みのURLは固定
  assert.equal(assignStoryPath(stories, { date: "2026-10-30", notionPageId: "a" }), "stories/2026-10-24/");
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

test("検証エラーには保留理由のコードが付く", () => {
  assert.throws(() => parseCard("過去", "不明なカード", "正位置"), (e) => e instanceof StoryValidationError && e.code === "INVALID_CARD");
  assert.throws(() => extractStoryHtml([]), (e) => e.code === "NO_STORY_BODY");
});

test("字数の注記は本文に含めない", () => {
  const blocks = [
    { type: "heading_2", heading_2: { rich_text: rich("短編小説") } },
    { type: "paragraph", paragraph: { rich_text: rich("本文") } },
    { type: "paragraph", paragraph: { rich_text: rich("(字数:1,492字/空白・改行を除く)") } },
    { type: "paragraph", paragraph: { rich_text: rich("（字数:1,509字/空白・改行・題名を除く）") } }
  ];
  assert.equal(extractStoryHtml(blocks), "<p>本文</p>");
});

function readingPage(extra = {}) {
  return {
    id: "reading-id",
    last_edited_time: "2026-10-24T00:00:00Z",
    properties: {
      "公開タイトル": { rich_text: rich("見送る手") },
      "公開日": { date: { start: "2026-10-24" } },
      "公開先": { select: { name: "月夜の短編集" } },
      "過去カード": { rich_text: rich("皇帝(IV)") },
      "過去正逆": { select: { name: "正位置" } },
      "現在カード": { rich_text: rich("正義(XI)") },
      "現在正逆": { select: { name: "逆位置" } },
      "未来カード": { rich_text: rich("悪魔(XV)") },
      "未来正逆": { select: { name: "逆位置" } },
      "相談文": { rich_text: rich("定年を前に<迷って>います。") },
      "AI読解 過去": { rich_text: rich("過去の読み\n二段落目") },
      "AI読解 現在": { rich_text: rich("現在の読み") },
      "AI読解 未来": { rich_text: rich("未来の読み") },
      "AI読解 まとめ": { rich_text: rich("まとめの読み") },
      "AI問いかけ": { rich_text: rich("鎖を外した後、何を選ぶのか。") },
      ...extra
    }
  };
}
const storyBlocks = [
  { type: "heading_2", heading_2: { rich_text: rich("短編小説") } },
  { type: "paragraph", paragraph: { rich_text: rich("本文") } }
];

test("相談文と読み解きがあれば、占いの記録ページを作り本編からリンクする", () => {
  const story = buildStoryFromPage(readingPage(), storyBlocks);
  assert.match(renderStoryPage(story), /href="reading\/"/);
  const html = renderReadingPage(story);
  assert.match(html, /<h1>見送る手<\/h1>/);
  assert.match(html, /定年を前に&lt;迷って&gt;います。/);
  assert.match(html, /<p>過去の読み<\/p><p>二段落目<\/p>/);
  assert.match(html, /<img class="reversed" src="..\/..\/..\/assets\/tarot\/11.svg"/);
  assert.match(html, /鎖を外した後、何を選ぶのか。/);
  assert.match(html, /href="..\/"/);
});

test("読み解きが欠けている作品には記録ページもリンクも作らない", () => {
  const story = buildStoryFromPage(readingPage({ "AI読解 未来": { rich_text: [] } }), storyBlocks);
  assert.equal(story.reading, null);
  assert.doesNotMatch(renderStoryPage(story), /reading\//);
});
