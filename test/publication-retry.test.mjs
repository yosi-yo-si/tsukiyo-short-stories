import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOrRetry } from '../scripts/publication-retry.mjs';

const base = 'b'.repeat(40), head = 'a'.repeat(40);
function fixture({ moved = false } = {}) {
  const calls = [];
  return { calls, github: {
    paginate: async () => [{ filename: 'index.html', status: 'modified' }],
    rest: {
      pulls: {
        listFiles() {},
        get: async () => ({ data: {
          state: 'open', draft: false, changed_files: 1,
          head: { sha: head, ref: 'automation/notion-publish', repo: { full_name: 'owner/blog' } },
          base: { ref: 'main', repo: { full_name: 'owner/blog' } },
          user: { login: 'github-actions[bot]' }, labels: [{ name: 'automated-publish' }]
        } }),
        merge: async () => { calls.push('merge'); return { data: { merged: true, sha: head } }; }
      },
      repos: { getBranch: async () => ({ data: { commit: { sha: moved ? head : base } } }) },
      actions: { createWorkflowDispatch: async args => calls.push(args) }
    }
  } };
}
const args = { context: { repo: { owner: 'owner', repo: 'blog' }, sha: 'c'.repeat(40) }, number: 7, expectedSha: head, mainSha: base };
test('uses the actual checked-out main rather than the stale event SHA', async () => {
  const { github, calls } = fixture();
  await mergeOrRetry({ ...args, github });
  assert.equal(calls[0], 'merge');
  assert.equal(calls[1].workflow_id, 'deploy-cloudflare.yml');
});
test('main movement requests a fresh full sync and never merges stale output', async () => {
  const { github, calls } = fixture({ moved: true });
  assert.deepEqual(await mergeOrRetry({ ...args, github }), { outcome: 'retry_requested' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].inputs, { retry_count: '1' });
  assert.equal(calls[0].ref, 'main');
});
test('retry limit prevents an endless dispatch chain', async () => {
  const { github, calls } = fixture({ moved: true });
  await assert.rejects(mergeOrRetry({ ...args, github, retryCount: 2 }), { code: 'MAIN_CHANGED' });
  assert.deepEqual(calls, []);
});

test('retry decision uses the error code rather than message text', async () => {
  const { github, calls } = fixture();
  github.rest.repos.getBranch = async () => { throw Object.assign(new Error('任意の文言'), { code: 'MAIN_CHANGED' }); };
  assert.deepEqual(await mergeOrRetry({ ...args, github }), { outcome: 'retry_requested' });
  assert.equal(calls[0].workflow_id, 'sync-notion.yml');
  calls.length = 0;
  github.rest.repos.getBranch = async () => { throw new Error('Main changed; retry with the latest main'); };
  await assert.rejects(mergeOrRetry({ ...args, github }), /Main changed/);
  assert.deepEqual(calls, []);
});

test('a failed retry dispatch remains an actual job failure', async () => {
  const { github } = fixture({ moved: true });
  github.rest.actions.createWorkflowDispatch = async () => { throw new Error('dispatch unavailable'); };
  await assert.rejects(mergeOrRetry({ ...args, github }), /dispatch unavailable/);
});

test("keeps repo from an Actions-style context whose repo is a prototype getter", async () => {
  class ActionsContext {
    get repo() { return { owner: "owner", repo: "blog" }; }
    get sha() { return "c".repeat(40); }
  }
  let seen;
  const github = {
    paginate: async () => [],
    rest: { pulls: { get: async (args) => { seen = args; throw new Error("stop"); }, listFiles() {} } }
  };
  await assert.rejects(mergeOrRetry({ github, context: new ActionsContext(), number: 7, expectedSha: "a".repeat(40), mainSha: "b".repeat(40) }));
  assert.equal(seen.owner, "owner");
  assert.equal(seen.repo, "blog");
});
