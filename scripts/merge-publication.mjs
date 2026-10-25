const indexes = new Set(["index.html", "archive-date.html", "archive-title.html", "content/stories.json"]);

export function validatePublication(pr, files, { repository, expectedSha }) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "")) throw new Error("Missing verified publication SHA");
  if (pr.state !== "open" || pr.draft || pr.head.sha !== expectedSha
    || pr.head.ref !== "automation/notion-publish" || pr.base.ref !== "main"
    || pr.head.repo?.full_name !== repository || pr.base.repo?.full_name !== repository
    || pr.user?.login !== "github-actions[bot]"
    || !pr.labels?.some(label => label.name === "automated-publish")) {
    throw new Error("PR does not match the verified publication");
  }
  if (!files.length || files.length !== pr.changed_files || files.some(file =>
    !["added", "modified"].includes(file.status)
    || !(indexes.has(file.filename) || /^stories\/\d{4}-\d{2}-\d{2}(?:-[1-9]\d*)?\/(?:reading\/)?index\.html$/.test(file.filename))
  )) throw new Error("Publication contains unexpected file changes");
}

export async function mergePublication({ github, context, number, expectedSha }) {
  const repo = context.repo;
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...repo, pull_number: number, per_page: 100
  });
  validatePublication(pr, files, {
    repository: `${repo.owner}/${repo.repo}`, expectedSha
  });
  // Fail closed if main moved since this run checked out and verified the site.
  const { data: base } = await github.rest.repos.getBranch({ ...repo, branch: "main" });
  if (base.commit.sha !== context.sha) {
    const error = new Error("Main changed; retry with the latest main");
    error.code = "MAIN_CHANGED";
    throw error;
  }
  const { data: merge } = await github.rest.pulls.merge({
    ...repo, pull_number: number, sha: expectedSha, merge_method: "squash"
  });
  if (!merge.merged) throw new Error(merge.message || "Publication merge failed");
  // GITHUB_TOKEN merges do not trigger push workflows. Dispatch explicitly.
  await github.rest.actions.createWorkflowDispatch({
    ...repo, workflow_id: "deploy-cloudflare.yml", ref: "main",
    inputs: { commit_sha: merge.sha }
  });
  console.log(`Merged publication #${number}; dispatched deployment of ${merge.sha}`);
}
