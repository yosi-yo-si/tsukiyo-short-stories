import { mergePublication } from './merge-publication.mjs';

// Re-run the whole import and verification; never rebase already verified output.
export async function mergeOrRetry({ github, context, number, expectedSha, mainSha, retryCount = 0 }) {
  if (!/^[a-f0-9]{40}$/.test(mainSha ?? '')) throw new Error('Missing checked-out main SHA');
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 2) throw new Error('Invalid retry count');
  try {
    await mergePublication({ github, context: { ...context, sha: mainSha }, number, expectedSha });
  } catch (error) {
    if (error.message === 'Main changed; retry with the latest main' && retryCount < 2) {
      await github.rest.actions.createWorkflowDispatch({
        ...context.repo, workflow_id: 'sync-notion.yml', ref: 'main',
        inputs: { retry_count: String(retryCount + 1) }
      });
      console.warn('Main moved; a fresh import and verification have been requested.');
    }
    throw error;
  }
}
