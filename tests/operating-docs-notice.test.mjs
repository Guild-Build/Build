// Offline checks for the operating-docs-notice hook (bundles/runbook-first). The hook runs for real with bash in
// temporary folders, the way Claude Code runs a SessionStart command hook: in the session's folder, with
// CLAUDE_PROJECT_DIR set to it and the hook input on standard input. No model, network or paid service is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync,
  truncateSync, writeFileSync } from 'node:fs';
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
const LIMIT = 1200;
const asRoot = process.getuid?.() === 0;
// The bash the hook runs under, found before any recording folder goes first on PATH.
const BASH = (process.env.PATH || '').split(':').map(d => join(d, 'bash')).find(p => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });

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
// A folder of stand-ins for every command on PATH, made once: each appends its name and arguments to the file named by
// DOCS_NOTICE_CALLS as one line in one write (commands in a pipeline run at once), then runs the real command. With it
// first on PATH, a test sees every command the hook runs.
let recordingPath = null;
function recorder() {
  if (recordingPath) return recordingPath;
  recordingPath = mkdtempSync(join(tmpdir(), 'docs-notice-path-'));
  process.on('exit', () => rmSync(recordingPath, { recursive: true, force: true }));
  const seen = new Set();
  for (const folder of (process.env.PATH || '').split(':')) {
    if (!folder || /['\\]/.test(folder)) continue;
    let names = [];
    try { names = readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (seen.has(name) || !/^[A-Za-z0-9._+-]+$/.test(name)) continue;
      const real = join(folder, name);
      try { accessSync(real, constants.X_OK); if (!statSync(real).isFile()) continue; } catch { continue; }
      seen.add(name);
      writeFileSync(join(recordingPath, name), `#!/bin/sh\nsep="$(printf '\\037')"\nline='${name}'\nfor a in "$@"; do line="$line$sep$a"; done\nprintf '%s\\n' "$line" >> "$DOCS_NOTICE_CALLS"\nexec '${real}' "$@"\n`, { mode: 0o755 });
    }
  }
  return recordingPath;
}
// Runs the hook as Claude Code does. Returns its exit status and signal, its context text (null when it printed
// nothing), its standard error, how long it took, and, with record, every command it ran as [name, ...arguments].
function run(dir, { cwd = dir, projectDir = dir, record = false, timeout = 10_000 } = {}) {
  const extra = projectDir === null ? {} : { CLAUDE_PROJECT_DIR: projectDir };
  const calls = record ? join(mkdtempSync(join(tmpdir(), 'docs-notice-calls-')), 'calls') : null;
  if (record) Object.assign(extra, { PATH: `${recorder()}:${process.env.PATH}`, DOCS_NOTICE_CALLS: calls });
  const started = Date.now();
  const r = spawnSync(BASH, [HOOK], { cwd, encoding: 'utf8', input: INPUT, timeout, env: env(dir, extra) });
  const ms = Date.now() - started;
  const ran = record && existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean).map(line => line.split('\x1f')) : [];
  const base = { status: r.status, signal: r.signal, ms, stderr: r.stderr, calls: ran };
  if (r.stdout === '') return { ...base, text: null };
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(out.hookSpecificOutput.additionalContext.length <= LIMIT, `${out.hookSpecificOutput.additionalContext.length} characters`);
  return { ...base, text: out.hookSpecificOutput.additionalContext };
}
// The commands the hook may run, with the only arguments it may give them: git to find the top folder, head for the
// README's first 64 KB, and grep, head -n 20 and tr on standard input. Returns how many times the README was read.
function onlyReadsReadme(calls, readme) {
  let heads = 0;
  for (const [name, ...args] of calls) {
    if (name === 'head' && args[0] === '-n') assert.deepEqual(args, ['-n', '20']);
    else if (name === 'head') { assert.deepEqual(args, ['-c', '65536', readme]); heads++; }
    else if (name === 'grep') assert.deepEqual(args.slice(0, 4), ['-a', '-o', '-i', '-E']), assert.equal(args.length, 5);
    else if (name === 'tr') assert.deepEqual(args, ['A-Z', 'a-z']);
    else if (name === 'git') assert.deepEqual(args, ['rev-parse', '--show-toplevel']);
    else assert.fail(`the hook ran ${[name, ...args].join(' ')}`);
  }
  return heads;
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

test('at most eight documents are listed besides the README', t => {
  const files = { 'AGENTS.md': 'a', 'CLAUDE.md': 'c', '.github/copilot-instructions.md': 'g', 'RUNBOOK.md': 'r', 'docs/RUNBOOK.md': 'd', 'CONTRIBUTING.md': 'c',
    'docs/CONTRIBUTING.md': 'c', '.github/CONTRIBUTING.md': 'c' };
  let pointers = '';
  for (let i = 0; i < 30; i++) { files[`ops/runbook-${String(i).padStart(2, '0')}-${'x'.repeat(60)}.md`] = 'x'; pointers += ` ops/runbook-${String(i).padStart(2, '0')}-${'x'.repeat(60)}.md`; }
  files['README.md'] = `See${pointers}.\n`;
  const r = run(gitRepo(folder(t, files)));
  const listed = r.text.split('\n')[0].replace('Operating documents in this repository: ', '').split(/, (?![^()]*\))/);
  assert.equal(listed.filter(item => !item.startsWith('README.md')).length, 8);
});

test('unreadable entries, a pipe and a folder under conventional names are left out, and the hook exits 0', t => {
  const dir = gitRepo(folder(t, { 'docs/RUNBOOK.md': 'Operations.\n', 'AGENTS.md': 'secret\n', 'README.md': 'See AGENTS.md and docs/RUNBOOK.md.\n' }));
  chmodSync(join(dir, 'AGENTS.md'), 0);
  // A pipe and a folder under conventional names; an open of the pipe would block until the timeout.
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

test('a very large README is read only to its first 64 KB, and no command reads a 2 GB runbook', t => {
  const dir = gitRepo(folder(t, { 'CONTRIBUTING.md': 'How to contribute.\n', 'ops/runbook-late.md': 'x', 'ops/runbook-early.md': 'x' }));
  writeFileSync(join(dir, 'README.md'), `See ops/runbook-early.md.\n${'filler line\n'.repeat(400_000)}See ops/runbook-late.md and CONTRIBUTING.md.\n`);
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/RUNBOOK.md'), '');
  truncateSync(join(dir, 'docs/RUNBOOK.md'), 2 * 1024 ** 3); // 2 GB, sparse
  const r = run(dir, { record: true });
  assert.equal(r.text, context('docs/RUNBOOK.md (runbook), CONTRIBUTING.md (contributing guide), ops/runbook-early.md (runbook), README.md (points to ops/runbook-early.md)'));
  assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 1);
  assert.ok(r.ms < 5000, `${r.ms} ms`);
});

test('no command reads any file but the README, and the README only to its first 64 KB', t => {
  const dir = gitRepo(folder(t, { 'AGENTS.md': 'a\n', 'CLAUDE.md': 'c\n', '.github/copilot-instructions.md': 'g\n', 'docs/RUNBOOK.md': 'r\n',
    'CONTRIBUTING.md': 'c\n', 'ops/runbook-x.md': 'x\n', 'README.md': 'See AGENTS.md, RUNBOOK.md and ops/runbook-x.md.\n' }));
  const r = run(dir, { record: true });
  assert.match(r.text, /README\.md \(points to AGENTS\.md, docs\/RUNBOOK\.md, ops\/runbook-x\.md\)/);
  assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 1);
});

// What the shell itself would open is seen through the entry: an open of a pipe blocks until the timeout, and an open
// of a file or folder nobody may read fails with an error on standard error. Each kind is put under every conventional
// name and under a name the README points to.
test('nothing under a conventional or pointed name is opened when it is a pipe, an unreadable file or an unreadable folder', t => {
  const names = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', 'RUNBOOK.md', 'runbook.md', 'docs/RUNBOOK.md', 'docs/runbook.md',
    'CONTRIBUTING.md', 'docs/CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'ops/runbook-x.md'];
  const kinds = { pipe: path => assert.equal(spawnSync('mkfifo', [path]).status, 0),
    'unreadable file': path => { writeFileSync(path, 'x'); chmodSync(path, 0); },
    'unreadable folder': path => { mkdirSync(path); chmodSync(path, 0); } };
  for (const [kind, make] of Object.entries(kinds)) {
    if (asRoot && kind !== 'pipe') continue; // root may open what nobody else may
    const dir = gitRepo(folder(t, { 'README.md': 'See ops/runbook-x.md, AGENTS.md, docs/RUNBOOK.md and CONTRIBUTING.md.\n' }));
    for (const name of names) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      if (!existsSync(join(dir, name))) make(join(dir, name)); // RUNBOOK.md and runbook.md are one name on a case-insensitive disk
    }
    const r = run(dir, { record: true, timeout: 5000 });
    assert.deepEqual([r.status, r.signal, r.text, r.stderr], [0, null, null, ''], kind);
    assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 1, kind);
  }
});

// A document or the README counts only when it is a regular file that is not a symbolic link, under folders that are
// not symbolic links below the top folder.
test('a symbolic link is never listed or read: to a document, a folder or a README outside, a file inside, or nothing', t => {
  for (const projectDir of ['set', null]) {
    const make = () => {
      const base = folder(t);
      mkdirSync(join(base, 'repo'));
      mkdirSync(join(base, 'outside/docs'), { recursive: true });
      gitRepo(join(base, 'repo'));
      return [join(base, 'repo'), join(base, 'outside')];
    };
    const runIn = (dir, opts = {}) => run(dir, { projectDir: projectDir === null ? null : dir, ...opts });
    let [dir, outside] = make();
    writeFileSync(join(outside, 'instructions.md'), 'external instructions\n');
    symlinkSync('../outside/instructions.md', join(dir, 'AGENTS.md'));
    assert.equal(runIn(dir).text, null, 'a linked document');
    [dir, outside] = make();
    writeFileSync(join(outside, 'docs/RUNBOOK.md'), 'external runbook\n');
    symlinkSync('../outside/docs', join(dir, 'docs'));
    assert.equal(runIn(dir).text, null, 'a linked parent folder');
    [dir, outside] = make();
    mkdirSync(join(dir, 'ops'));
    writeFileSync(join(dir, 'ops/runbook-x.md'), 'inside\n');
    writeFileSync(join(outside, 'README.md'), 'See ops/runbook-x.md.\n');
    symlinkSync('../outside/README.md', join(dir, 'README.md'));
    const linkedReadme = runIn(dir, { record: true });
    assert.equal(linkedReadme.text, null, 'a linked README');
    assert.equal(onlyReadsReadme(linkedReadme.calls, ''), 0, 'a linked README is not read');
    [dir] = make();
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs/RUNBOOK.md'), 'inside\n');
    symlinkSync('docs/RUNBOOK.md', join(dir, 'CONTRIBUTING.md'));
    assert.equal(runIn(dir).text, context('docs/RUNBOOK.md (runbook)'), 'a link to a file inside: only the target, by its own name');
    [dir] = make();
    symlinkSync('missing.md', join(dir, 'RUNBOOK.md'));
    assert.equal(runIn(dir).text, null, 'a broken link');
  }
});

// The text stays within 1,200 characters: when the list does not fit, the documents that fit are kept in order, each
// whole, and the list ends with how many more there are. The long names here are admitted: they exist and the README
// points to them (the review's reproduction, 10,828 characters before the bound).
test('the text never exceeds 1,200 characters: long names that are admitted are left out whole and counted', t => {
  const dir = gitRepo(folder(t));
  const parent = Array.from({ length: 4 }, (_, i) => i + 'x'.repeat(159)).join('/');
  mkdirSync(join(dir, parent), { recursive: true });
  const refs = Array.from({ length: 8 }, (_, i) => `${parent}/runbook-${i}.md`);
  for (const ref of refs) writeFileSync(join(dir, ref), 'x');
  writeFileSync(join(dir, 'README.md'), refs.join('\n'));
  const r = run(dir);
  assert.equal(r.text, context(`${refs[0]} (runbook), and 8 more`));
  assert.equal(r.text.length, 878);
});

test('at the bound the whole list is kept, and with a name one character longer the last entry is counted instead', t => {
  for (const [length, kept] of [[483, true], [484, false]]) {
    const dir = gitRepo(folder(t));
    const doc = `${'a'.repeat(200)}/${'b'.repeat(200)}/runbook-${'c'.repeat(length - 413)}.md`;
    assert.equal(doc.length, length);
    mkdirSync(join(dir, dirname(doc)), { recursive: true });
    writeFileSync(join(dir, doc), 'x');
    writeFileSync(join(dir, 'README.md'), `${doc}\n`);
    const r = run(dir);
    if (kept) {
      assert.equal(r.text, context(`${doc} (runbook), README.md (points to ${doc})`));
      assert.equal(r.text.length, LIMIT);
    } else {
      assert.equal(r.text, context(`${doc} (runbook), and 1 more`));
      assert.equal(r.text.length, 706);
    }
  }
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
