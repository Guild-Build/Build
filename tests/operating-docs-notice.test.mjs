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
const FIXED = context('').length; // the sentences around the list: 200 characters
// The list the hook should give, from its rule: every entry when the whole list fits, ending with ", and N more" for
// documents found beyond the eight listed; otherwise each entry, in order, that fits after the entries kept before it
// together with that ending, whose N counts every entry and document left out. The ending's length depends only on
// how many digits N has.
function expectedList(entries, beyondEight = 0) {
  const ending = n => `, and ${n} more`;
  const whole = entries.join(', ') + (beyondEight ? ending(beyondEight) : '');
  if (FIXED + whole.length <= LIMIT) return whole;
  for (const digits of [1, 2]) {
    const kept = [];
    for (const entry of entries) if (FIXED + [...kept, entry].join(', ').length + ending('9'.repeat(digits)).length <= LIMIT) kept.push(entry);
    const more = entries.length - kept.length + beyondEight;
    if (String(more).length <= digits) return kept.length ? kept.join(', ') + ending(more) : `${more}, with names too long to list`;
  }
  throw new Error('more than 99 left out');
}
// A path of exactly `length` characters that a README can point to: folders of 150 characters, then a file name that
// starts with "runbook".
function docPath(length) {
  const folders = [];
  let rest = length;
  while (rest > 211) { folders.push(String.fromCharCode(97 + folders.length).repeat(150)); rest -= 151; }
  return [...folders, `runbook-${'c'.repeat(rest - 11)}.md`].join('/');
}
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

test('at most eight documents are listed besides the README, and the documents found beyond them are counted', t => {
  // Eight documents by conventional name, then a README naming 30 more: the hook looks at the first 20 names, which all
  // exist, so 20 more are counted (a two-digit count, with the whole list fitting).
  const conventional = { 'AGENTS.md': 'agent instructions', 'CLAUDE.md': 'agent instructions', '.github/copilot-instructions.md': 'agent instructions',
    'RUNBOOK.md': 'runbook', 'docs/RUNBOOK.md': 'runbook', 'CONTRIBUTING.md': 'contributing guide', 'docs/CONTRIBUTING.md': 'contributing guide',
    '.github/CONTRIBUTING.md': 'contributing guide' };
  const files = Object.fromEntries(Object.keys(conventional).map(name => [name, 'x']));
  const refs = Array.from({ length: 30 }, (_, i) => `ops/runbook-${String(i).padStart(2, '0')}-${'x'.repeat(60)}.md`);
  for (const ref of refs) files[ref] = 'x';
  files['README.md'] = `See ${refs.join(' ')}.\n`;
  const entries = Object.entries(conventional).map(([name, kind]) => `${name} (${kind})`);
  assert.equal(run(gitRepo(folder(t, files))).text, context(expectedList(entries, 20)));
  assert.match(context(expectedList(entries, 20)), /contributing guide\), and 20 more\.\n/);
  // No document by conventional name; a README naming eight documents of 483 characters, then twelve short ones. The
  // eight are entries and the twelve are counted. Two entries take 988 characters, which leaves room for an ending of
  // 12 characters but not for ", and 20 more" (13): the count has two digits, so only the first entry stays.
  const long = Array.from({ length: 8 }, (_, i) => docPath(483).replace('runbook-c', `runbook-${i}`));
  const extra = Array.from({ length: 12 }, (_, i) => `ops/runbook-extra-${String(i).padStart(2, '0')}.md`);
  for (const ref of long) assert.equal(ref.length, 483);
  const dir = gitRepo(folder(t, Object.fromEntries([...long, ...extra].map(ref => [ref, 'x']).concat([['README.md', `See ${[...long, ...extra].join(' ')}.\n`]]))));
  const r = run(dir);
  assert.equal(r.text, context(expectedList([...long.map(ref => `${ref} (runbook)`), `README.md (points to ${long.join(', ')})`], 12)));
  assert.equal(r.text, context(`${long[0]} (runbook), and 20 more`));
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

test('a very large README: no command reads past its first 64 KB, a pointer after it is not followed, and no command reads a 2 GB runbook', t => {
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
test('under every conventional and pointed name, a pipe is never opened, and an unreadable file or folder causes no error and no command', t => {
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
// not symbolic links below the top folder. Every case records the commands the hook runs, and runs twice: with a
// regular file behind the link, to see whether it is listed or read by a command, and with a pipe behind it, whose
// opening would block until the timeout.
test('a symbolic link is never listed, a pipe behind one is never opened, and no command reads through one', t => {
  const make = (base, target) => (path, content) => (target === 'pipe'
    ? assert.equal(spawnSync('mkfifo', [path]).status, 0)
    : writeFileSync(path, content));
  for (const projectDir of ['set', null]) {
    for (const target of ['file', 'pipe']) {
      const setUp = () => {
        const base = folder(t);
        mkdirSync(join(base, 'repo'));
        mkdirSync(join(base, 'outside/docs'), { recursive: true });
        gitRepo(join(base, 'repo'));
        return [join(base, 'repo'), join(base, 'outside'), make(base, target)];
      };
      const check = (dir, expected, label) => {
        const r = run(dir, { projectDir: projectDir === null ? null : dir, record: true, timeout: 5000 });
        assert.deepEqual([r.status, r.signal, r.text, r.stderr], [0, null, expected, ''], `${label} (${target} behind the link)`);
        assert.equal(onlyReadsReadme(r.calls, ''), 0, `${label}: no command reads anything`);
      };
      let [dir, outside, put] = setUp();
      put(join(outside, 'instructions.md'), 'external instructions\n');
      symlinkSync('../outside/instructions.md', join(dir, 'AGENTS.md'));
      check(dir, null, 'a linked document');
      [dir, outside, put] = setUp();
      put(join(outside, 'docs/RUNBOOK.md'), 'external runbook\n');
      symlinkSync('../outside/docs', join(dir, 'docs'));
      check(dir, null, 'a linked parent folder');
      [dir, outside, put] = setUp();
      mkdirSync(join(dir, 'ops'));
      writeFileSync(join(dir, 'ops/runbook-x.md'), 'inside\n');
      put(join(outside, 'README.md'), 'See ops/runbook-x.md.\n');
      symlinkSync('../outside/README.md', join(dir, 'README.md'));
      check(dir, null, 'a linked README');
      [dir, outside, put] = setUp();
      mkdirSync(join(dir, 'docs'));
      put(join(dir, 'docs/RUNBOOK.md'), 'inside\n');
      symlinkSync('docs/RUNBOOK.md', join(dir, 'CONTRIBUTING.md'));
      // A regular target is listed under its own, conventional name; a pipe is listed under none.
      check(dir, target === 'file' ? context('docs/RUNBOOK.md (runbook)') : null, 'a link to a file inside');
      [dir] = setUp();
      symlinkSync('missing.md', join(dir, 'RUNBOOK.md'));
      check(dir, null, 'a broken link');
    }
  }
});

// The text stays within 1,200 characters: when the list does not fit, the documents that fit are kept in order, each
// whole, and the list ends with how many more there are. The long names here are admitted: they exist and the README
// points to them (the review's reproduction, 10,828 characters before the bound).
test('with long admitted names the text stays within 1,200 characters, and names that do not fit are left out whole and counted', t => {
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

// The bound, swept. For a document that comes first and for one that comes after another, at every path length from
// well below the point where the whole list stops fitting to beyond the point where the document itself stops fitting:
// the text is what the rule gives, the count in it is the number of entries it leaves out, the document is listed
// exactly when the text listing it after the entries before it is at most 1,200 characters, and no name is cut. The
// second review's reproduction is one more case, run as that review ran it: in a folder that is not a git repository,
// with CLAUDE_PROJECT_DIR=., and a README that points to a runbook of 976 to 979 characters under four folders of 200.
test('the bound, swept: a document is listed exactly when the text listing it is at most 1,200 characters, the count is right, and no name is cut', t => {
  // Runs the hook with a README that points to doc, after the documents in before; returns whether doc is listed.
  const check = (dir, before, doc, where, projectDir = dir) => {
    mkdirSync(join(dir, dirname(doc)), { recursive: true });
    writeFileSync(join(dir, doc), 'x');
    writeFileSync(join(dir, 'README.md'), `${doc}\n`);
    const entries = [...before, `${doc} (runbook)`, `README.md (points to ${doc})`];
    const r = run(dir, { projectDir });
    assert.equal(r.status, 0, where);
    assert.equal(r.text, context(expectedList(entries)), where);
    const listed = r.text.includes(`${doc} (runbook)`);
    const whole = FIXED + entries.join(', ').length;
    const listing = FIXED + [...before, `${doc} (runbook)`].join(', ').length + ', and 1 more'.length;
    assert.equal(listed, whole <= LIMIT || listing <= LIMIT, where);
    // The count, read from the text, is the number of entries the text leaves out.
    const count = /, and (\d+) more\.\n/.exec(r.text) || /: (\d+), with names too long to list\.\n/.exec(r.text);
    assert.equal(count ? Number(count[1]) : 0, entries.filter(entry => !r.text.includes(entry)).length, `${where}: the count`);
    // The path is made of runs of one letter; once every whole copy of it is taken out, no such run may be left.
    assert.doesNotMatch(r.text.split(doc).join(''), /([a-z])\1{19}/, `${where}: a name is cut`);
    return listed;
  };
  const dir = mkdtempSync('/tmp/dn-'); // a short top folder, so that the longest paths stay within the system's path limit
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  gitRepo(dir);
  for (const before of [[], ['AGENTS.md (agent instructions)']]) {
    if (before.length) writeFileSync(join(dir, 'AGENTS.md'), 'x\n');
    let listedAt = 0;
    for (let length = 400; length <= 990; length++) {
      if (check(dir, before, docPath(length), `${before.length ? 'later' : 'first'} document, ${length} characters`)) listedAt = length;
    }
    assert.equal(listedAt, before.length ? 946 : 978); // the last length listed: 1,200 characters exactly
  }
  const review = mkdtempSync('/tmp/dn-');
  t.after(() => rmSync(review, { recursive: true, force: true }));
  assert.equal(git(review, 'rev-parse', '--show-toplevel').status, 128, 'the review\'s folder must not be inside a git repository');
  for (const length of [976, 977, 978, 979]) {
    const doc = ['a', 'b', 'c', 'd'].map(c => c.repeat(200)).join('/') + '/runbook-' + 'x'.repeat(length - 815) + '.md';
    assert.equal(doc.length, length);
    assert.equal(check(review, [], doc, `the review's reproduction, ${length} characters`, '.'), length <= 978);
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

test('a missing or unreadable folder gives no text and exit 0', t => {
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
