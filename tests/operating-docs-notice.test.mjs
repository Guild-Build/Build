// Offline checks for the operating-docs-notice hook (bundles/runbook-first). The hook runs for real with bash in
// temporary folders, the way Claude Code runs a SessionStart command hook: in the session's folder, with
// CLAUDE_PROJECT_DIR set to it and the hook input on standard input. No model, network or paid service is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(repo, 'bundles/runbook-first');
const HOOK = join(BUNDLE, 'scripts/operating-docs-notice.sh');
const INPUT = JSON.stringify({ session_id: 'test', cwd: '', hook_event_name: 'SessionStart', source: 'startup' });
const READ = 'Before you change anything, read the ones that govern the requested change.';
const REPLY = 'Run the checks they name, and say in your reply which of these documents you read.';
const context = list => `Operating documents in this repository: ${list}.\n${READ}\n${REPLY}`;

function env(home, extra = {}) {
  const e = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...extra };
  for (const name of Object.keys(e)) if (/^GIT_(DIR|WORK_TREE|CONFIG_COUNT|CONFIG_KEY_|CONFIG_VALUE_)/.test(name)) delete e[name];
  return e;
}
function folder(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-notice-'));
  t.after(() => { spawnSync('chmod', ['-R', 'u+rwx', dir]); rmSync(dir, { recursive: true, force: true }); });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: env(dir) });
const gitRepo = dir => { git(dir, 'init', '-q', '-b', 'main'); return dir; };
// Runs the hook as Claude Code does; returns its exit status, its context text (or null when it printed nothing) and
// how long it took.
function run(dir, { cwd = dir, projectDir = dir } = {}) {
  const started = Date.now();
  const r = spawnSync('bash', [HOOK], { cwd, encoding: 'utf8', input: INPUT, timeout: 10_000, env: env(dir, projectDir === null ? {} : { CLAUDE_PROJECT_DIR: projectDir }) });
  const ms = Date.now() - started;
  if (r.stdout === '') return { status: r.status, text: null, ms, stderr: r.stderr };
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  return { status: r.status, text: out.hookSpecificOutput.additionalContext, ms, stderr: r.stderr };
}

test('a repository with no operating document gets no text', t => {
  for (const files of [{}, { 'README.md': '# Tool\n\nRun `make` to build it.\n' }, { 'docs/guide.md': 'How to use it.\n', 'notes/runbook.txt': 'not markdown\n' }]) {
    const r = run(gitRepo(folder(t, files)));
    assert.equal(r.status, 0);
    assert.equal(r.text, null, JSON.stringify(files));
  }
});

test('one operating document is named, and so is a README that points to it', t => {
  const dir = gitRepo(folder(t, { 'docs/RUNBOOK.md': '# Runbook\n' }));
  assert.equal(run(dir).text, context('docs/RUNBOOK.md (runbook)'));
  writeFileSync(join(dir, 'README.md'), '# Service\n\nFollow `docs/RUNBOOK.md` before you deploy.\n');
  assert.equal(run(dir).text, context('docs/RUNBOOK.md (runbook), README.md (points to docs/RUNBOOK.md)'));
});

test('several operating documents are named in a fixed order, with what a README points to', t => {
  const dir = gitRepo(folder(t, {
    'CONTRIBUTING.md': 'How to contribute.\n',
    'docs/RUNBOOK.md': 'Operations.\n',
    'AGENTS.md': 'Agents read this.\n',
    '.github/copilot-instructions.md': 'Copilot reads this.\n',
    'CLAUDE.md': 'Claude reads this.\n',
    'ops/runbook-deploy.md': 'Deploy steps.\n',
    // A pointer by file name only, a pointer to a document found by name, and one to a file in an unusual place.
    'README.md': '# Service\n\nSee [the guide](./CONTRIBUTING.md), RUNBOOK.md and ops/runbook-deploy.md. Not docs/missing-runbook.md.\n',
  }));
  assert.equal(run(dir).text, context('AGENTS.md (agent instructions), CLAUDE.md (agent instructions), .github/copilot-instructions.md (agent instructions), '
    + 'docs/RUNBOOK.md (runbook), CONTRIBUTING.md (contributing guide), ops/runbook-deploy.md (runbook), '
    + 'README.md (points to CONTRIBUTING.md, docs/RUNBOOK.md, ops/runbook-deploy.md)'));
});

test('at most eight documents are listed, and the text stays far below the 10,000-character limit', t => {
  const files = { 'AGENTS.md': 'a', 'CLAUDE.md': 'c', '.github/copilot-instructions.md': 'g', 'RUNBOOK.md': 'r', 'docs/RUNBOOK.md': 'd', 'CONTRIBUTING.md': 'c',
    'docs/CONTRIBUTING.md': 'c', '.github/CONTRIBUTING.md': 'c' };
  let pointers = '';
  for (let i = 0; i < 30; i++) { files[`ops/runbook-${String(i).padStart(2, '0')}-${'x'.repeat(60)}.md`] = 'x'; pointers += ` ops/runbook-${String(i).padStart(2, '0')}-${'x'.repeat(60)}.md`; }
  files['README.md'] = `See${pointers}.\n`;
  const r = run(gitRepo(folder(t, files)));
  const listed = r.text.split('\n')[0].replace('Operating documents in this repository: ', '').split(/, (?![^()]*\))/);
  assert.equal(listed.filter(item => !item.startsWith('README.md')).length, 8);
  assert.ok(r.text.length < 2000, `${r.text.length} characters`);
});

test('unreadable entries are left out without being opened, and never stop the hook', t => {
  const dir = gitRepo(folder(t, { 'docs/RUNBOOK.md': 'Operations.\n', 'AGENTS.md': 'secret\n', 'README.md': 'See AGENTS.md and docs/RUNBOOK.md.\n' }));
  chmodSync(join(dir, 'AGENTS.md'), 0);
  // A pipe and a folder under conventional names: opening the pipe would block, so it must not be opened.
  assert.equal(spawnSync('mkfifo', [join(dir, 'RUNBOOK.md')]).status, 0);
  mkdirSync(join(dir, 'CONTRIBUTING.md'));
  const r = run(dir);
  assert.equal(r.status, 0);
  const unreadable = process.getuid?.() === 0 ? 'AGENTS.md (agent instructions), ' : '';
  assert.equal(r.text, context(`${unreadable}docs/RUNBOOK.md (runbook), README.md (points to ${unreadable ? 'AGENTS.md, ' : ''}docs/RUNBOOK.md)`));
  assert.ok(r.ms < 5000, `${r.ms} ms`);
  // An unreadable README is skipped; the documents found by name are still named.
  chmodSync(join(dir, 'README.md'), 0);
  if (process.getuid?.() !== 0) assert.equal(run(dir).text, context('docs/RUNBOOK.md (runbook)'));
});

test('a very large README is read only to its first 64 KB, and a large document is never read', t => {
  const dir = gitRepo(folder(t, { 'CONTRIBUTING.md': 'How to contribute.\n', 'ops/runbook-late.md': 'x', 'ops/runbook-early.md': 'x' }));
  writeFileSync(join(dir, 'README.md'), `See ops/runbook-early.md.\n${'filler line\n'.repeat(400_000)}See ops/runbook-late.md and CONTRIBUTING.md.\n`);
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/RUNBOOK.md'), '');
  truncateSync(join(dir, 'docs/RUNBOOK.md'), 2 * 1024 ** 3); // 2 GB, sparse
  const r = run(dir);
  assert.equal(r.text, context('docs/RUNBOOK.md (runbook), CONTRIBUTING.md (contributing guide), ops/runbook-early.md (runbook), README.md (points to ops/runbook-early.md)'));
  assert.ok(r.ms < 5000, `${r.ms} ms`);
});

test('a folder that is not a git repository is searched as it is', t => {
  const dir = folder(t, { 'AGENTS.md': 'Agents read this.\n', 'README.md': 'Read AGENTS.md first.\n' });
  assert.equal(git(dir, 'rev-parse', '--show-toplevel').status, 128, 'the test folder must not be inside a git repository');
  assert.equal(run(dir).text, context('AGENTS.md (agent instructions), README.md (points to AGENTS.md)'));
});

test('a session in a subfolder of a repository gets the documents at its top folder', t => {
  const dir = gitRepo(folder(t, { 'docs/RUNBOOK.md': 'Operations.\n', 'src/app/main.js': '' }));
  const sub = join(dir, 'src/app');
  assert.equal(run(dir, { cwd: sub, projectDir: sub }).text, context('docs/RUNBOOK.md (runbook)'));
  // Without CLAUDE_PROJECT_DIR the hook uses its working folder.
  assert.equal(run(dir, { cwd: sub, projectDir: null }).text, context('docs/RUNBOOK.md (runbook)'));
});

test('it never fails a session: a missing or unreadable folder gives no text and exit 0', t => {
  const dir = folder(t, { 'docs/RUNBOOK.md': 'x' });
  assert.deepEqual([run(dir, { projectDir: join(dir, 'gone') }).status, run(dir, { projectDir: join(dir, 'gone') }).text], [0, null]);
  if (process.getuid?.() !== 0) {
    chmodSync(dir, 0);
    const r = run(dir, { cwd: tmpdir() });
    assert.deepEqual([r.status, r.text], [0, null]);
    chmodSync(dir, 0o755);
  }
});

// The trial's repositories are where the build is measured. Each fixture runs as the eval runs it, then the hook.
test('in each of the Client Deployment Trial\'s eight repositories the hook names the runbook and the README that points to it', t => {
  const cases = join(repo, 'content/trials/client-deployment-v1/cases');
  const expected = context('docs/RUNBOOK.md (runbook), README.md (points to docs/RUNBOOK.md)');
  for (const name of readdirSync(cases).sort()) {
    const dir = folder(t);
    const fx = spawnSync('bash', ['-e', join(cases, name, 'fixture.sh')], { cwd: dir, encoding: 'utf8', env: env(dir) });
    assert.equal(fx.status, 0, fx.stderr);
    const r = run(dir);
    assert.equal(r.text, expected, name);
    t.diagnostic(`${name}: ${r.text.length} characters`);
  }
  assert.equal(expected.length, 264);
});

// General, not fitted to the trial: no client name, no case name, no file name from the trial's repositories (their
// scripts, configuration and logs) and no word about trials or graders, in anything the build ships. The names shared
// on purpose are the conventional README.md and RUNBOOK.md, and the generic .gitignore, package.json and VERSION.
test('nothing the build ships names the trial, its clients, files or scripts', t => {
  const cases = join(repo, 'content/trials/client-deployment-v1/cases');
  const banned = new Set(['trial', 'grader', 'client-deployment']);
  for (const name of readdirSync(cases)) {
    const dir = folder(t);
    spawnSync('bash', ['-e', join(cases, name, 'fixture.sh')], { cwd: dir, env: env(dir) });
    const tracked = git(dir, 'ls-files').stdout.split('\n').filter(Boolean);
    for (const path of tracked) {
      const file = path.split('/').pop();
      if (!['README.md', 'RUNBOOK.md', '.gitignore', 'package.json', 'VERSION'].includes(file)) banned.add(file.toLowerCase());
    }
    const client = readFileSync(join(dir, 'README.md'), 'utf8').match(/maintains for ([A-Z]\w+)/)?.[1];
    assert.ok(client, name);
    banned.add(client.toLowerCase());
    banned.add(name);
  }
  const shipped = [];
  const walk = d => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else shipped.push(p); } };
  walk(BUNDLE);
  for (const file of shipped) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const word of banned) assert.ok(!new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9]|$)`).test(text), `${file.slice(BUNDLE.length + 1)} names "${word}"`);
  }
  assert.ok(banned.size > 40, `${banned.size} names checked`);
});

test('the build passes buildguild check, and its hook runs through bash with a short timeout', () => {
  const r = spawnSync(process.execPath, [join(repo, 'cli/buildguild.mjs'), 'check', BUNDLE, '--no-validator'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const hooks = JSON.parse(readFileSync(join(BUNDLE, 'hooks/hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks), ['SessionStart']);
  const [entry] = hooks.SessionStart;
  assert.equal(entry.matcher, 'startup|clear|compact');
  assert.deepEqual(entry.hooks, [{ type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/operating-docs-notice.sh"', timeout: 5 }]);
  const manifest = JSON.parse(readFileSync(join(BUNDLE, 'buildguild.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(BUNDLE, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(plugin.version, manifest.version);
  assert.deepEqual(manifest.modules, ['hook/operating-docs-notice']);
});
