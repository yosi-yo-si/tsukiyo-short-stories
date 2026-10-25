import test from "node:test";
import assert from "node:assert/strict";
import { validatePublication, mergePublication } from "../scripts/merge-publication.mjs";

const sha = "a".repeat(40), baseSha = "b".repeat(40), mergedSha = "c".repeat(40);
function fixture() {
  return {
    state: "open", draft: false, changed_files: 1,
    head: { sha, ref: "automation/notion-publish", repo: { full_name: "owner/blog" } },
    base: { ref: "main", repo: { full_name: "owner/blog" } },
    user: { login: "github-actions[bot]" }, labels: [{ name: "automated-publish" }]
  };
}
const files = [{ filename: "stories/2026-10-24/index.html", status: "added" }];
const options = { repository: "owner/blog", expectedSha: sha };

test("accepts generated article and index updates", () => {
  for (const filename of ["stories/2026-10-24/index.html", "stories/2026-10-24-2/index.html", "stories/2026-10-24/reading/index.html", "stories/2026-10-25-3/reading/index.html", "content/stories.json", "index.html", "archive-title.html", "archive-date.html"]) {
    validatePublication(fixture(), [{ filename, status: "modified" }], options);
  }
});
test("rejects code, workflow, assets, deleted, renamed, and hidden paths", () => {
  for (const filename of ["scripts/site-lib.mjs", ".github/workflows/sync-notion.yml", "styles.css", "stories/../../index.html", "stories/2026-10-24/other.html", "stories/2026-10-24-0/index.html", "stories/2026-10-24-x/index.html", "stories/2026-10-24/reading/other.html", "stories/2026-10-24/other/index.html", "stories/2026-10-24/reading/reading/index.html"]) {
    assert.throws(() => validatePublication(fixture(), [{ filename, status: "modified" }], options));
  }
  for (const status of ["removed", "renamed"]) {
    assert.throws(() => validatePublication(fixture(), [{ ...files[0], status }], options));
  }
});
test("rejects changed head, foreign repo, human PR, missing label, draft, wrong branch and incomplete file list", () => {
  const variants = [
    p => p.head.sha = "d".repeat(40),
    p => p.head.repo.full_name = "other/blog",
    p => p.user.login = "someone",
    p => p.labels = [],
    p => p.draft = true,
    p => p.base.ref = "other",
    p => p.head.ref = "feature/code",
    p => p.state = "closed",
    p => p.changed_files = 2
  ];
  for (const mutate of variants) {
    const pr = fixture(); mutate(pr);
    assert.throws(() => validatePublication(pr, files, options));
  }
  assert.throws(() => validatePublication(fixture(), files, { ...options, expectedSha: "" }));
});
function client({ moved = false, merged = true } = {}) {
  const calls = [];
  return { calls, github: {
    paginate: async () => files,
    rest: {
      pulls: {
        get: async () => ({ data: fixture() }),
        listFiles() {},
        merge: async args => { calls.push(["merge", args]); return { data: { merged, sha: mergedSha } }; }
      },
      repos: { getBranch: async () => ({ data: { commit: { sha: moved ? sha : baseSha } } }) },
      actions: { createWorkflowDispatch: async args => calls.push(["deploy", args]) }
    }
  } };
}
const context = { repo: { owner: "owner", repo: "blog" }, sha: baseSha };
test("merges only the expected SHA and explicitly deploys the merged commit", async () => {
  const { github, calls } = client();
  await mergePublication({ github, context, number: 7, expectedSha: sha });
  assert.equal(calls[0][1].sha, sha);
  assert.equal(calls[1][0], "deploy");
  assert.equal(calls[1][1].inputs.commit_sha, mergedSha);
});
test("does not merge when main moved or deploy when merge failed", async () => {
  for (const config of [{ moved: true }, { merged: false }]) {
    const { github, calls } = client(config);
    await assert.rejects(mergePublication({ github, context, number: 7, expectedSha: sha }));
    assert.ok(!calls.some(([name]) => name === "deploy"));
    if (config.moved) assert.equal(calls.length, 0);
  }
});
