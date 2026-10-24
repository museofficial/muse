import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {validateSnapshot} from '../.github/scripts/validate-pr-snapshot.mjs';

const fixture = () => ({
  sha: 'a'.repeat(40),
  prNumber: '123',
  repository: 'owner/muse',
  event: {
    repository: {full_name: 'owner/muse'},
    workflow_run: {event: 'pull_request', conclusion: 'success', path: '.github/workflows/pr-snapshot.yml',
      head_sha: 'b'.repeat(40), head_repository: {full_name: 'contributor/muse'}},
  },
  pr: {number: 123, state: 'open', merge_commit_sha: 'a'.repeat(40),
    base: {repo: {full_name: 'owner/muse'}}, head: {sha: 'b'.repeat(40), repo: {full_name: 'contributor/muse'}}},
});

describe('PR snapshot publishing boundary', () => {
  it('accepts the current merge snapshot of the originating fork PR', () => {
    expect(validateSnapshot(fixture())).toEqual({sha: 'a'.repeat(40), prNumber: '123'});
  });

  it.each(['sha', 'prNumber'] as const)('rejects malformed %s before publication', key => {
    const input = fixture();
    input[key] = 'invalid-identifier';
    expect(() => validateSnapshot(input)).toThrow('Invalid snapshot identifiers');
  });

  it.each(['event', 'conclusion', 'path'] as const)('rejects an unrelated or failed build: %s', key => {
    const input = fixture();
    input.event.workflow_run[key] = 'different';
    expect(() => validateSnapshot(input)).toThrow('successful PR build');
  });

  it.each(['number', 'base', 'head'] as const)('rejects an unrelated PR: %s', field => {
    const input = fixture();
    if (field === 'number') {input.pr.number = 456;}
    else {input.pr[field].repo.full_name = 'unrelated/muse';}
    expect(() => validateSnapshot(input)).toThrow('originating PR repository');
  });

  it.each(['closed', 'new-head', 'new-merge'])('skips a stale snapshot: %s', reason => {
    const input = fixture();
    if (reason === 'closed') {input.pr.state = 'closed';}
    if (reason === 'new-head') {input.pr.head.sha = 'c'.repeat(40);}
    if (reason === 'new-merge') {input.pr.merge_commit_sha = 'c'.repeat(40);}
    expect(validateSnapshot(input)).toBeNull();
  });

  it('keeps registry write access behind validation and uses a fixed preview tag', async () => {
    const workflow = await readFile(new URL('../.github/workflows/pr-release.yml', import.meta.url), 'utf8');
    const [validation, publication] = workflow.split('  release-and-comment:');
    expect(validation).toContain('ref: ${{ github.workflow_sha }}');
    expect(validation).not.toContain('packages: write');
    expect(publication).toContain('needs: validate');
    expect(publication).toContain("if: needs.validate.outputs.sha != ''");
    expect(publication).toContain('-t "${REGISTRY_IMAGE}:pr-${PR_NUMBER}"');
    expect(workflow).not.toContain('metadata.json');
  });
});
