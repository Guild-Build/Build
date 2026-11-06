import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { treeHash } from '../cli/compare.mjs';

const temp = t => { const p = mkdtempSync(join(tmpdir(), 'bg-pack-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };
test('content identity includes file names, bytes and executable mode', t => {
  const root = temp(t);
  mkdirSync(join(root, 'one')); mkdirSync(join(root, 'two'));
  writeFileSync(join(root, 'one', 'task.sh'), 'true\n', { mode: 0o644 });
  writeFileSync(join(root, 'two', 'task.sh'), 'true\n', { mode: 0o644 });
  const hash = treeHash(join(root, 'one'));
  assert.equal(hash, treeHash(join(root, 'two')));
  chmodSync(join(root, 'two', 'task.sh'), 0o755);
  assert.notEqual(hash, treeHash(join(root, 'two')));
  chmodSync(join(root, 'two', 'task.sh'), 0o644);
  writeFileSync(join(root, 'two', 'task.sh'), 'false\n');
  assert.notEqual(hash, treeHash(join(root, 'two')));
});

test('packed CLI resolves comparison imports and rejects unsupported effort before any runner access', t => {
  const root = temp(t);
  cpSync(new URL('../cli/', import.meta.url), join(root, 'cli'), { recursive: true });
  const pack = spawnSync(process.execPath, [join(root, 'cli/pack.mjs')], { encoding: 'utf8' });
  assert.equal(pack.status, 0, pack.stderr);
  const cli = join(root, 'cli/dist/cli/buildguild.mjs');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /compare <current-folder>/);
  for (const command of ['test', 'wrap', 'compare']) {
    const result = spawnSync(process.execPath, [cli, command, '--effort', 'high'], { encoding: 'utf8', env: { PATH: '' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--effort is not supported/);
  }
  assert.match(readFileSync(join(root, 'cli/dist/cli/comparison-results.mjs'), 'utf8'), /buildguild.comparison.v1/);
});
