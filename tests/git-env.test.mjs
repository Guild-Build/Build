// The suite must pass whatever git setup its caller has. These tests break the caller's git setup in each way that can
// reach a child process, show that each one breaks git for a child that inherits it and that none reaches a child given
// cleanGitEnv, then run the rest of the suite under a caller broken in all of those ways at once and require every test
// in that run to pass or be skipped.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanGitEnv } from './git-env.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const self = basename(fileURLToPath(import.meta.url));

// Each way, as a change to an environment. The repository GIT_DIR names is never created here, so a child that used it
// leaves it behind.
function brokenSetup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bg-broken-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const unparsable = join(dir, 'broken.gitconfig');
  writeFileSync(unparsable, '[core\nbroken =\n[user\n');
  mkdirSync(join(dir, 'xdg/git'), { recursive: true });
  writeFileSync(join(dir, 'xdg/git/ignore'), '*\n');
  const elsewhere = join(dir, 'elsewhere.git');
  const ways = {
    'a global config file git cannot parse': env => ({ ...env, GIT_CONFIG_GLOBAL: unparsable }),
    'a system config file git cannot parse': env => {
      const broken = { ...env, GIT_CONFIG_SYSTEM: unparsable };
      delete broken.GIT_CONFIG_NOSYSTEM;
      return broken;
    },
    'a setting git refuses, through GIT_CONFIG_COUNT': env => ({ ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'broken', GIT_CONFIG_VALUE_0: '1' }),
    'a setting git refuses, through GIT_CONFIG_PARAMETERS': env => ({ ...env, GIT_CONFIG_PARAMETERS: "'broken'" }),
    'a GIT_DIR naming a repository elsewhere': env => ({ ...env, GIT_DIR: elsewhere }),
    'a global ignore file, under XDG_CONFIG_HOME, that hides every file': env => ({ ...env, XDG_CONFIG_HOME: join(dir, 'xdg') }),
  };
  const all = env => Object.values(ways).reduce((broken, way) => way(broken), env);
  return { ways, all, elsewhere };
}

// Commits the one file of a new folder to a new repository, then prints the repository's folder and the files it
// tracks. Where git works as it should, that is the folder's own .git and a.txt.
function probe(t, envFor) {
  const folder = mkdtempSync(join(tmpdir(), 'bg-git-probe-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'a.txt'), 'a\n');
  const script = 'git init -q && git add -A && git -c user.name=probe -c user.email=probe@example.invalid commit -qm probe'
    + ' && git rev-parse --absolute-git-dir && git ls-files';
  const r = spawnSync('bash', ['-c', script], { cwd: folder, encoding: 'utf8', timeout: 30_000, env: envFor(folder) });
  return { works: r.status === 0 && r.stdout === `${join(realpathSync(folder), '.git')}\na.txt\n`, said: `exit ${r.status}: ${r.stdout}${r.stderr}` };
}

// The counts in the closing summary of a run with the TAP reporter.
const summary = tap => Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
  .map(name => [name, Number([...tap.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))].at(-1)?.[1])]));

// Why a `node --test --test-reporter=tap` run does not show every test passing or skipped, with at least one passing;
// none when it does. A test marked TODO counts against the run whether it passed or failed: Node reports a failing TODO
// test as `not ok … # TODO`, with fail 0 and exit 0.
function runProblems(r) {
  const exit = `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}`;
  const c = summary(r.stdout);
  if (Object.values(c).some(Number.isNaN)) return [`${exit}, with no complete TAP summary`];
  const problems = r.status === 0 ? [] : [exit];
  if (c.fail) problems.push(`${c.fail} of ${c.tests} tests failed`);
  if (c.cancelled) problems.push(`${c.cancelled} of ${c.tests} tests were cancelled`);
  if (c.todo) problems.push(`${c.todo} of ${c.tests} tests are marked TODO`);
  if (c.pass + c.skipped !== c.tests) problems.push(`${c.pass + c.skipped} of ${c.tests} tests passed or were skipped`);
  if (!c.pass) problems.push('no test passed');
  return problems;
}

test('each way a caller can break git reaches a child that inherits it, and none reaches a child given cleanGitEnv', t => {
  const { ways, all, elsewhere } = brokenSetup(t);
  const plain = probe(t, folder => cleanGitEnv(folder));
  assert.equal(plain.works, true, plain.said);
  for (const [name, way] of Object.entries(ways)) {
    const inherited = probe(t, folder => way(cleanGitEnv(folder)));
    assert.equal(inherited.works, false, `${name}: git worked for a child that inherited it`);
    const cleaned = probe(t, folder => cleanGitEnv(folder, way(process.env)));
    assert.equal(cleaned.works, true, `${name}: ${cleaned.said}`);
  }
  rmSync(elsewhere, { recursive: true, force: true });
  const cleaned = probe(t, folder => cleanGitEnv(folder, all(process.env)));
  assert.equal(cleaned.works, true, `all at once: ${cleaned.said}`);
  assert.equal(existsSync(elsewhere), false);
  const env = cleanGitEnv('/home-folder', all(process.env));
  assert.deepEqual(Object.keys(env).filter(name => name.startsWith('GIT_')).sort(), ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT']);
  assert.deepEqual([env.HOME, env.GIT_CONFIG_GLOBAL, env.GIT_CONFIG_NOSYSTEM, env.GIT_TERMINAL_PROMPT, env.XDG_CONFIG_HOME], ['/home-folder', '/dev/null', '1', '0', undefined]);
});

test('the rest of the suite passes under a caller whose git setup is broken in all of those ways at once', t => {
  const { all, elsewhere } = brokenSetup(t);
  const env = all({ ...process.env });
  delete env.NODE_TEST_CONTEXT;
  assert.equal(probe(t, () => env).works, false, 'git worked for a child of the broken caller');
  rmSync(elsewhere, { recursive: true, force: true });
  const files = readdirSync(join(repo, 'tests')).filter(name => name.endsWith('.test.mjs') && name !== self).sort().map(name => join('tests', name));
  // The files whose tests start git are among them.
  for (const name of ['client-deployment-trial', 'handoff-trial', 'operating-docs-notice']) assert.ok(files.includes(`tests/${name}.test.mjs`), files.join(', '));
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: repo, encoding: 'utf8', env, timeout: 600_000, maxBuffer: 256 * 1024 * 1024 });
  const problems = runProblems(r);
  const failures = r.stdout.split('\n').filter(line => /^\s*not ok /.test(line) || /\bfatal: /.test(line)).slice(0, 40).join('\n');
  assert.deepEqual(problems, [], `${problems.join('; ')}\n${failures}\n${r.stderr.slice(-2000)}`);
  assert.equal(existsSync(elsewhere), false, 'a child used the repository the caller\'s GIT_DIR names');
  const { pass, tests } = summary(r.stdout);
  t.diagnostic(`${files.length} test files, ${pass} of ${tests} tests passed under the broken caller`);
});

// runProblems on real runs of throwaway test files in a temporary folder, failing and passing TODO tests among them.
test('the nested run counts only tests that pass or are skipped, so a failing TODO test, which Node reports with fail 0 and exit 0, is refused', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bg-nested-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  let files = 0;
  const run = body => {
    const file = join(dir, `case-${++files}.test.mjs`);
    writeFileSync(file, `import test from 'node:test';\nimport assert from 'node:assert/strict';\n${body}`);
    return spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: dir, encoding: 'utf8', env, timeout: 60_000 });
  };
  assert.deepEqual(runProblems(run("test('passes', () => {});\ntest('skipped', { skip: true }, () => {});\n")), []);
  const failingTodo = run("test('passes', () => {});\ntest('fails, marked TODO', { todo: true }, () => assert.fail('broken'));\n");
  assert.match(failingTodo.stdout, /^not ok 2 - fails, marked TODO # TODO$/m);
  assert.deepEqual([failingTodo.status, summary(failingTodo.stdout).fail], [0, 0]);
  assert.deepEqual(runProblems(failingTodo), ['1 of 2 tests are marked TODO', '1 of 2 tests passed or were skipped']);
  assert.deepEqual(runProblems(run("test('passes', () => {});\ntest('passes, marked TODO', { todo: true }, () => {});\n")),
    ['1 of 2 tests are marked TODO', '1 of 2 tests passed or were skipped']);
  assert.deepEqual(runProblems(run("test('fails', () => assert.fail('broken'));\n")),
    ['exit 1', '1 of 1 tests failed', '0 of 1 tests passed or were skipped', 'no test passed']);
  assert.deepEqual(runProblems(run("test('skipped', { skip: true }, () => {});\n")), ['no test passed']);
});
