import {readFileSync, appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const validateIdentifiers = (sha, prNumber) => {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]{0,9}$/.test(prNumber)) {
    throw new Error('Invalid snapshot identifiers');
  }
};

export const validateSnapshot = ({sha, prNumber, repository, event, pr}) => {
  validateIdentifiers(sha, prNumber);
  const run = event.workflow_run;
  if (event.repository?.full_name !== repository
    || run?.event !== 'pull_request'
    || run.conclusion !== 'success'
    || run.path !== '.github/workflows/pr-snapshot.yml') {
    throw new Error('Snapshot did not come from a successful PR build');
  }
  if (pr.number !== Number(prNumber) || pr.base?.repo?.full_name !== repository
    || pr.head?.repo?.full_name !== run.head_repository?.full_name) {
    throw new Error('Snapshot does not belong to the originating PR repository');
  }
  // Old or closed PR runs must not replace a newer preview image. Fork runs
  // often have no pull_requests entry, so verify their artifact against the API.
  if (pr.state !== 'open' || pr.head.sha !== run.head_sha || pr.merge_commit_sha !== sha) {
    return null;
  }
  return {sha, prNumber};
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = readFileSync('/tmp/snapshot-sha/sha.txt', 'utf8').trim();
    const prNumber = readFileSync('/tmp/snapshot-pr/pull_request_number.txt', 'utf8').trim();
    validateIdentifiers(sha, prNumber);
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      throw new Error('Invalid repository');
    }
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const pr = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/pulls/${prNumber}`], {encoding: 'utf8'}));
    const snapshot = validateSnapshot({sha, prNumber, repository, event, pr});
    if (snapshot) {
      appendFileSync(process.env.GITHUB_OUTPUT, `sha=${snapshot.sha}\npr_number=${snapshot.prNumber}\n`);
    } else {
      console.log('Skipping snapshot for a closed or superseded PR revision.');
    }
  } catch {
    console.error('PR snapshot validation failed; nothing will be published.');
    process.exitCode = 1;
  }
}
