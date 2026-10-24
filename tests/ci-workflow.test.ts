import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';

describe('GitHub test workflow', () => {
  it('tests the exact minimum Node version and rolling Node 22', async () => {
    const workflow = await readFile(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
    const matrixValues = workflow.match(/matrix:\s*\n\s+node-version:\s*\[([^\]]+)\]/u)?.[1]
      .split(',')
      .map(value => value.trim().replaceAll(/["']/g, ''));

    expect(matrixValues).toEqual(['22.12.0', '22']);
    expect(workflow).toContain('node-version: ${{ matrix.node-version }}');
  });
});
