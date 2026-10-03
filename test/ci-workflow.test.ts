import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CI release job packages tagged main releases before final artifact upload', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
  const releaseJob = workflow.match(/\n {2}release:\n([\s\S]*?)\n {2}upload-artifact:/)?.[1] ?? '';
  const artifactJob = workflow.match(/\n {2}upload-artifact:\n([\s\S]*)$/)?.[1] ?? '';

  assert.match(workflow, /tags:\s*\['\*'\]/);
  assert.match(releaseJob, /needs:\s*build/);
  assert.match(releaseJob, /if:\s*\$\{\{\s*github\.ref_type\s*==\s*'tag'\s*\}\}/);
  assert.match(releaseJob, /runs-on:\s*macos-latest/);
  assert.match(releaseJob, /contents:\s*write/);
  assert.match(releaseJob, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(releaseJob, /ci-build-output/);
  assert.match(releaseJob, /prepare-release\.sh/);
  assert.match(releaseJob, /gh release (?:create|upload)/);
  assert.match(releaseJob, /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(artifactJob, /needs:\s*\[build, release\]/);
  assert.match(artifactJob, /needs\.release\.result\s*==\s*'skipped'/);
});
