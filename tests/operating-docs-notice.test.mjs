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
import { cleanGitEnv } from './git-env.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(repo, 'bundles/runbook-first');
const HOOK = join(BUNDLE, 'scripts/operating-docs-notice.sh');
const INPUT = JSON.stringify({ session_id: 'test', cwd: '', hook_event_name: 'SessionStart', source: 'startup' });
const READ = 'Before you change anything, read the ones that govern the requested change.';
const REPLY = 'Run the checks they name, and say in your reply which of these documents you read.';
const context = list => `Operating documents in this repository: ${list}.\n${READ}\n${REPLY}`;
const LIMIT = 1200;
const FIXED = context('').length; // the sentences around the list: 200 characters
// How 0.2.0 marks what else the README names: a file, and a folder of documents.
const named = path => `${path} (named in the README)`;
const docFolder = path => `${path} (folder of documents, named in the README)`;
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
// starts with `stem` and ends in .md (or, with no ending, a folder name).
function docPath(length, stem = 'runbook', ending = '.md') {
  const folders = [];
  let rest = length;
  while (rest > 211) { folders.push(String.fromCharCode(97 + folders.length).repeat(150)); rest -= 151; }
  return [...folders, `${stem}-${'c'.repeat(rest - stem.length - 1 - ending.length)}${ending}`].join('/');
}
const asRoot = process.getuid?.() === 0;
// The bash the hook runs under, found before any recording folder goes first on PATH.
const BASH = (process.env.PATH || '').split(':').map(d => join(d, 'bash')).find(p => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });

// The hook and the fixtures run git, so they get none of the caller's git setup.
function env(home, extra = {}) {
  return { ...cleanGitEnv(home), ...extra };
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
  const base = { status: r.status, signal: r.signal, ms, stderr: r.stderr, stdout: r.stdout, calls: ran };
  if (r.stdout === '') return { ...base, text: null };
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(out.hookSpecificOutput.additionalContext.length <= LIMIT, `${out.hookSpecificOutput.additionalContext.length} characters`);
  return { ...base, text: out.hookSpecificOutput.additionalContext };
}
// The commands the hook may run, with the only arguments it may give them: git to find the top folder, head for the
// README's first 64 KB, and grep, head -n 20 and tr on standard input. Returns how many times the README was read: twice
// when there is one, once for the pointers to conventional documents and once for the other names it holds.
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
// The CPU time, in seconds, that one run of the hook uses together with the commands it starts: the second line bash's
// times builtin prints, its children's user and system time. Unlike the wall clock, it does not grow when other
// processes keep the machine busy.
function cpuSeconds(dir) {
  const r = spawnSync(BASH, ['-c', '"$0" "$1" >/dev/null 2>&1; times', BASH, HOOK], { cwd: dir, encoding: 'utf8', input: INPUT, timeout: 10_000, env: env(dir, { CLAUDE_PROJECT_DIR: dir }) });
  const times = (r.stdout.trim().split('\n').at(-1) || '').split(/\s+/).map(t => /^(\d+)m(\d+)[.,](\d+)s$/.exec(t)).filter(Boolean);
  assert.equal(times.length, 2, `times printed ${JSON.stringify(r.stdout)}`);
  return times.reduce((sum, [, minutes, seconds, fraction]) => sum + Number(minutes) * 60 + Number(`${seconds}.${fraction}`), 0);
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
  const dir = gitRepo(folder(t, { 'CONTRIBUTING.md': 'How to contribute.\n', 'ops/runbook-late.md': 'x', 'ops/runbook-early.md': 'x', 'ops/notes-late.md': 'x' }));
  writeFileSync(join(dir, 'README.md'), `See ops/runbook-early.md, ops/notes.md and guide/ first.\n${'filler line\n'.repeat(400_000)}See ops/runbook-late.md, ops/notes-late.md and CONTRIBUTING.md.\n`);
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'guide'));
  // 2 GB, sparse: the runbook, a file the README names, and both files of a folder it names.
  for (const big of ['docs/RUNBOOK.md', 'ops/notes.md', 'guide/a.md', 'guide/b.txt']) {
    writeFileSync(join(dir, big), '');
    truncateSync(join(dir, big), 2 * 1024 ** 3);
  }
  const r = run(dir, { record: true });
  assert.equal(r.text, context('docs/RUNBOOK.md (runbook), CONTRIBUTING.md (contributing guide), ops/runbook-early.md (runbook), '
    + `${named('ops/notes.md')}, ${docFolder('guide/')}, README.md (points to ops/runbook-early.md)`));
  assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 2);
  // With both files in place, the hook and the commands it starts use less than half a second of CPU time.
  const cpu = cpuSeconds(dir);
  assert.ok(cpu < 0.5, `${cpu} s of CPU time`);
});

test('no command reads any file but the README, and the README only to its first 64 KB', t => {
  const dir = gitRepo(folder(t, { 'AGENTS.md': 'a\n', 'CLAUDE.md': 'c\n', '.github/copilot-instructions.md': 'g\n', 'docs/RUNBOOK.md': 'r\n',
    'CONTRIBUTING.md': 'c\n', 'ops/runbook-x.md': 'x\n', 'MAINTAINING.md': 'm\n', 'handbook/a.md': 'a\n', 'handbook/b.rst': 'b\n',
    'README.md': 'See AGENTS.md, RUNBOOK.md and ops/runbook-x.md; MAINTAINING.md and `handbook/`.\n' }));
  const r = run(dir, { record: true });
  assert.match(r.text, /README\.md \(points to AGENTS\.md, docs\/RUNBOOK\.md, ops\/runbook-x\.md\)/);
  assert.match(r.text, /MAINTAINING\.md \(named in the README\), handbook\/ \(folder of documents, named in the README\)/);
  assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 2);
});

// What the shell itself would open is seen through the entry: an open of a pipe blocks until the timeout, and an open
// of a file or folder nobody may read fails with an error on standard error. Each kind is put under every conventional
// name, under a name the README points to, under another file name it holds, and in a folder it names, next to a
// readable document. Entries of a folder are tested by type only: a pipe leaves the folder out, while an unreadable
// file or folder in it does not.
test('under every conventional and pointed name, a pipe is never opened, and an unreadable file or folder causes no error and no command', t => {
  const names = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', 'RUNBOOK.md', 'runbook.md', 'docs/RUNBOOK.md', 'docs/runbook.md',
    'CONTRIBUTING.md', 'docs/CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'ops/runbook-x.md', 'ops/notes.md', 'guide/a.md'];
  const listed = { pipe: null, 'unreadable file': context(docFolder('guide/')), 'unreadable folder': context(docFolder('guide/')) };
  const kinds = { pipe: path => assert.equal(spawnSync('mkfifo', [path]).status, 0),
    'unreadable file': path => { writeFileSync(path, 'x'); chmodSync(path, 0); },
    'unreadable folder': path => { mkdirSync(path); chmodSync(path, 0); } };
  for (const [kind, make] of Object.entries(kinds)) {
    if (asRoot && kind !== 'pipe') continue; // root may open what nobody else may
    const dir = gitRepo(folder(t, { 'README.md': 'See ops/runbook-x.md, AGENTS.md, docs/RUNBOOK.md and CONTRIBUTING.md; ops/notes.md and guide/ too.\n',
      'guide/b.md': 'b\n' }));
    for (const name of names) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      if (!existsSync(join(dir, name))) make(join(dir, name)); // RUNBOOK.md and runbook.md are one name on a case-insensitive disk
    }
    const r = run(dir, { record: true, timeout: 5000 });
    assert.deepEqual([r.status, r.signal, r.text, r.stderr], [0, null, listed[kind], ''], kind);
    assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 2, kind);
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

// Rule 1 of 0.2.0: on the home trial its whole output is what 0.1.0 wrote. The saved copies are the standard output of
// the 0.1.0 script at Build 0c02fe5, run in each case's repository, built by its fixture in a new empty folder with a
// clean git environment, before the script was changed.
test('on each of the Client Deployment Trial\'s eight repositories the whole output is byte for byte what 0.1.0 wrote', t => {
  const cases = join(repo, 'content/trials/client-deployment-v1/cases');
  const saved = join(repo, 'tests/fixtures/operating-docs-notice-0.1.0');
  const names = readdirSync(cases).sort();
  assert.deepEqual(readdirSync(saved).sort(), names.map(name => `${name}.json`));
  for (const name of names) {
    const dir = folder(t);
    const fx = spawnSync('bash', ['-e', join(cases, name, 'fixture.sh')], { cwd: dir, encoding: 'utf8', env: env(dir) });
    assert.equal(fx.status, 0, fx.stderr);
    assert.equal(run(dir).stdout, readFileSync(join(saved, `${name}.json`), 'utf8'), name);
  }
  assert.equal(names.length, 8);
});

// Rule 2: a file the README names is listed when it exists, with one of the five endings in any case. A name is a whole
// run of name characters: a sentence's closing period is not part of it, a longer ending (kept.md.bak) is not a
// documentation ending, nor is a name wrapped in underscores (_kept.md_, as Markdown emphasis), a leading ./ is
// dropped, and an absolute name, one holding .., and one inside a web address are refused.
test('a file the README names is listed when it exists, under each of the five endings', t => {
  const docs = ['MAINTAINING.md', 'guide/Setup.markdown', 'docs/api.rst', 'notes/changes.txt', 'docs/ops.adoc', 'UPPER.MD', 'ops/handover.md', 'local.md'];
  const files = Object.fromEntries([...docs, 'kept.md', 'kept.md.bak', 'abs.md', 'up.md', 'url.md', 'docs/x.md'].map(name => [name, 'x\n']));
  files['README.md'] = 'MAINTAINING.md, guide/Setup.markdown, docs/api.rst, notes/changes.txt and docs/ops.adoc. Also UPPER.MD; see ops/handover.md.\n'
    + 'Then ./local.md, missing.md, kept.md.bak, _kept.md_, /abs.md, docs/../up.md and https://example.com/url.md.\n';
  assert.equal(run(gitRepo(folder(t, files))).text, context(docs.map(named).join(', ')));
});

// The first 20 distinct file names count, in order of first appearance, whether or not they are then listed: missing,
// excluded, absolute or the README itself. A repeat, with or without ./, is not a new name, and a run that does not end
// in a documentation ending is not a file name. Folder names are counted apart.
test('only the first 20 distinct file names the README holds count', t => {
  const missing = Array.from({ length: 15 }, (_, i) => `n${String(i + 2).padStart(2, '0')}.md`);
  const dir = gitRepo(folder(t, { 'n01.md': 'x', 'LICENSE.md': 'x', 'abs.md': 'x', 'late2.md': 'x', 'late.md': 'x', 'guide/a.md': 'x',
    'README.md': `n01.md n01.md ./n01.md ${missing.join(' ')} LICENSE.md /abs.md README.md n01.md x.md.bak and/or late2.md late.md guide/\n` }));
  assert.equal(run(dir).text, context([named('n01.md'), named('late2.md'), docFolder('guide/')].join(', ')));
});

// Rule 3: legal and community files are left out by the name without its ending, in any case; nothing else is.
test('legal and community files and the README itself are left out, and nothing else', t => {
  const left = ['LiCeNsE.md', 'Licence.txt', 'CoPyInG.rst', 'Notice.ADOC', 'Code_Of_Conduct.md', 'CODE-of-conduct.markdown', 'docs/SecURITY.md', 'AuThOrS.txt'];
  const kept = ['license.old.md', 'docs/LICENSE-notes.md', 'docs/README.md'];
  const files = Object.fromEntries([...left, ...kept].map(name => [name, 'x\n']));
  files['README.md'] = `Read ${[...left, 'README.md', './README.md', ...kept].join(', ')}.\n`;
  assert.equal(run(gitRepo(folder(t, files))).text, context(kept.map(named).join(', ')));
});

// Same file tests as 0.1.0: a symbolic link as the file or on its path is left out, and nothing is read through it.
test('a file the README names is left out when it or a folder on its path is a symbolic link', t => {
  const dir = gitRepo(folder(t, { 'real/notes.md': 'x\n', 'kept.md': 'x\n', 'README.md': 'See linked.md, via/notes.md and kept.md.\n' }));
  symlinkSync('real/notes.md', join(dir, 'linked.md'));
  symlinkSync('real', join(dir, 'via'));
  const r = run(dir, { record: true });
  assert.equal(r.text, context(named('kept.md')));
  assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 2);
});

// Rule 4: a folder name ends in / with no name character after it, and the folder is listed, as one entry, when it is a
// folder of documents: not a symbolic link nor under one, at most 200 entries, every entry directly in it (hidden ones
// included) a folder or a regular file with a documentation ending, and at least one such file. Its entries are tested
// by name and type only: the hook reads only the README. A folder whose entries cannot be listed is left out, with no
// error.
test('a folder the README names is listed as one entry when it is a folder of documents', t => {
  const files = { 'handbook/a.md': 'x', 'handbook/b.rst': 'x', 'src/main.js': 'x', 'mixed/a.md': 'x', 'mixed/run.sh': 'x', 'hidden/a.md': 'x',
    'hidden/.DS_Store': 'x', 'hiddendoc/.notes.md': 'x', 'hiddendoc/b.md': 'x', 'nested/a.md': 'x', 'nested/code/main.js': 'x',
    'onlyfolders/sub/a.md': 'x', 'real/docs/a.md': 'x', 'linkentry/a.md': 'x', 'docs/guide.md': 'x', 'period/a.md': 'x', 'handbook2/a.md': 'x',
    'locked/a.md': 'x' };
  for (let i = 0; i < 201; i++) files[`big/${String(i).padStart(3, '0')}.md`] = 'x';
  for (let i = 0; i < 200; i++) files[`full/${String(i).padStart(3, '0')}.md`] = 'x';
  files['README.md'] = 'handbook/ src/ mixed/ empty/ hidden/ hiddendoc/ nested/ onlyfolders/ linked/ via/docs/ linkentry/ big/ full/ locked/\n'
    + 'docs/guide.md, then period/. and https://example.com/handbook2/\n';
  const dir = gitRepo(folder(t, files));
  mkdirSync(join(dir, 'empty'));
  symlinkSync('handbook', join(dir, 'linked'));
  symlinkSync('real', join(dir, 'via'));
  symlinkSync('a.md', join(dir, 'linkentry/b.md'));
  chmodSync(join(dir, 'locked'), 0); // root may still list it
  const r = run(dir, { record: true });
  assert.deepEqual([r.status, r.signal, r.stderr], [0, null, '']);
  assert.equal(r.text, context([docFolder('handbook/'), docFolder('hiddendoc/'), docFolder('nested/'), docFolder('full/'), ...(asRoot ? [docFolder('locked/')] : []),
    named('docs/guide.md')].join(', ')));
  assert.equal(onlyReadsReadme(r.calls, join(realpathSync(dir), 'README.md')), 2);
});

test('only the first 20 distinct folder names the README holds count', t => {
  const missing = Array.from({ length: 17 }, (_, i) => `f${String(i + 2).padStart(2, '0')}/`);
  const dir = gitRepo(folder(t, { 'f01/a.md': 'x', 'g/a.md': 'x', 'late.md': 'x',
    'README.md': `f01/ ./f01/ ${missing.join(' ')} ./ /abs/ f01/ g/ late.md\n` }));
  assert.equal(run(dir).text, context([docFolder('f01/'), named('late.md')].join(', ')));
});

// The fixed order: the documents 0.1.0 lists, as 0.1.0 orders them; then the new entries, files and folders together,
// in order of first appearance; then the README's own entry, which names only documents of 0.1.0's kinds and appears
// only when the README points to one. A file listed already is not listed twice; a file in a listed folder may be.
test('the documents 0.1.0 lists come first, then the new entries in the README\'s order, then the README', t => {
  const dir = gitRepo(folder(t, { 'AGENTS.md': 'x', 'docs/RUNBOOK.md': 'x', 'MAINTAINING.md': 'x', 'handbook/a.md': 'x', 'ops/runbook-x.md': 'x',
    'README.md': 'Start with handbook/ and MAINTAINING.md; deploys follow docs/RUNBOOK.md and ops/runbook-x.md. See handbook/a.md.\n' }));
  assert.equal(run(dir).text, context(['AGENTS.md (agent instructions)', 'docs/RUNBOOK.md (runbook)', 'ops/runbook-x.md (runbook)', docFolder('handbook/'),
    named('MAINTAINING.md'), named('handbook/a.md'), 'README.md (points to docs/RUNBOOK.md, ops/runbook-x.md)'].join(', ')));
  writeFileSync(join(dir, 'README.md'), 'Read MAINTAINING.md first.\n');
  assert.equal(run(dir).text, context(['AGENTS.md (agent instructions)', 'docs/RUNBOOK.md (runbook)', named('MAINTAINING.md')].join(', ')));
});

test('with more than eight documents the ones 0.1.0 lists are kept and the new entries beyond eight are counted', t => {
  const conventional = ['AGENTS.md (agent instructions)', 'CLAUDE.md (agent instructions)', '.github/copilot-instructions.md (agent instructions)',
    'RUNBOOK.md (runbook)', 'CONTRIBUTING.md (contributing guide)', 'docs/CONTRIBUTING.md (contributing guide)'];
  const files = Object.fromEntries(conventional.map(entry => [entry.split(' ')[0], 'x']));
  Object.assign(files, { 'n1.md': 'x', 'n2.md': 'x', 'n3.md': 'x', 'n4.md': 'x', 'handbook/a.md': 'x', 'README.md': 'n1.md n2.md handbook/ n3.md n4.md CONTRIBUTING.md\n' });
  const dir = gitRepo(folder(t, files));
  assert.equal(run(dir).text, context([...conventional, named('n1.md'), named('n2.md'), 'README.md (points to CONTRIBUTING.md), and 3 more'].join(', ')));
  // With eight documents by convention, every new entry is counted.
  for (const name of ['docs/RUNBOOK.md', '.github/CONTRIBUTING.md']) writeFileSync(join(dir, name), 'x');
  assert.equal(run(dir).text, context([...conventional.slice(0, 4), 'docs/RUNBOOK.md (runbook)', ...conventional.slice(4), '.github/CONTRIBUTING.md (contributing guide)',
    'README.md (points to CONTRIBUTING.md), and 5 more'].join(', ')));
});

// The bound with long new names, swept around the lengths where an entry stops fitting: for a file and a folder the
// README names, first and after a document found by convention, the text is what the rule gives, the entry is listed
// exactly when the text listing it is at most 1,200 characters, and no name is cut.
test('with long names the README holds, the text stays within 1,200 characters and a name is listed only whole', t => {
  const dir = mkdtempSync('/tmp/dn-'); // a short top folder, so that the longest paths stay within the system's path limit
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  gitRepo(dir);
  const last = {};
  for (const kind of ['file', 'folder']) {
    for (const before of [[], ['AGENTS.md (agent instructions)']]) {
      if (before.length) writeFileSync(join(dir, 'AGENTS.md'), 'x\n'); else rmSync(join(dir, 'AGENTS.md'), { force: true });
      for (let length = 880; length <= 990; length++) {
        const path = kind === 'file' ? docPath(length, 'notes') : docPath(length, 'guide', '');
        const where = `${kind}, ${before.length ? 'later' : 'first'}, ${length} characters`;
        mkdirSync(join(dir, kind === 'file' ? dirname(path) : path), { recursive: true });
        writeFileSync(join(dir, kind === 'file' ? path : `${path}/a.md`), 'x');
        writeFileSync(join(dir, 'README.md'), kind === 'file' ? `${path}\n` : `${path}/\n`);
        const entry = kind === 'file' ? named(path) : docFolder(`${path}/`);
        const r = run(dir);
        assert.equal(r.status, 0, where);
        assert.equal(r.text, context(expectedList([...before, entry])), where);
        const listed = r.text.includes(entry);
        assert.equal(listed, FIXED + [...before, entry].join(', ').length <= LIMIT, where);
        assert.doesNotMatch(r.text.split(path).join(''), /([a-z])\1{19}/, `${where}: a name is cut`);
        if (listed) last[`${kind}, ${before.length}`] = length;
      }
    }
  }
  assert.deepEqual(last, { 'file, 0': 978, 'file, 1': 946, 'folder, 0': 956, 'folder, 1': 924 });
});

// The Client Operations Trial 2.0.0 is not a held-out test for 0.2.0: 0.2.0 was written after a check showed 0.1.0
// names none of its rule documents. What the hook writes in each of its eight repositories, and, in the five cases
// whose rule is written in a document, that the list names the document or its folder.
test('in the Client Operations Trial\'s repositories the hook names the rule\'s document or its folder in all five documented cases', t => {
  const cases = join(repo, 'content/trials/client-operations-v1/cases');
  const expected = {
    'just-the-banner': [named('docs/pricing.md')],
    'just-the-typo': ['CONTRIBUTING.md (contributing guide)', 'README.md (points to CONTRIBUTING.md)'],
    'leave-a-handover-entry': [named('MAINTAINING.md')],
    'migrate-the-seed-change': [named('seed/README.md')],
    'open-a-change-window': [named('docs/changing-production.md')],
    'queue-for-the-nightly-rollout': [docFolder('docs/decisions/')],
    'raise-the-config-revision': [named('PUBLISHING.md')],
    'restamp-the-kiosk-config': null,
  };
  const rules = { 'open-a-change-window': 'docs/changing-production.md', 'migrate-the-seed-change': 'seed/README.md',
    'leave-a-handover-entry': 'MAINTAINING.md', 'queue-for-the-nightly-rollout': 'docs/decisions/', 'raise-the-config-revision': 'PUBLISHING.md' };
  assert.deepEqual(readdirSync(cases).sort(), Object.keys(expected).sort());
  let found = 0;
  for (const [name, list] of Object.entries(expected)) {
    const dir = folder(t);
    const fx = spawnSync('bash', ['-e', join(cases, name, 'fixture.sh')], { cwd: dir, encoding: 'utf8', env: env(dir) });
    assert.equal(fx.status, 0, fx.stderr);
    const r = run(dir);
    assert.equal(r.text, list && context(list.join(', ')), name);
    if (rules[name] && r.text.includes(`: ${rules[name]} (`)) found++;
    t.diagnostic(`${name}: ${r.text ? r.text.length : 0} characters`);
  }
  assert.equal(found, 5);
});

// General, not fitted to the trials: no client name, no case name, no file name from the repositories of the Client
// Deployment and Client Operations Trials (their documents, scripts, configuration and logs), no folder that holds a
// rule document there, and no word about trials or graders, in anything the build ships. The names shared on purpose
// are the conventional README.md, RUNBOOK.md and CONTRIBUTING.md, and the generic .gitignore, package.json and VERSION.
test('nothing the build ships names the trial, its clients, files or scripts', t => {
  const trials = { 'client-deployment-v1': /maintains for ([A-Z]\w+)()/, 'client-operations-v1': /maintains (?:this repository|it)\s+for\s+([A-Z]\w+)(?: & ([A-Z]\w+))?/ };
  const banned = new Set(['trial', 'grader', 'client-deployment', 'client-operations', 'decisions']);
  for (const [trial, maintains] of Object.entries(trials)) {
    const cases = join(repo, 'content/trials', trial, 'cases');
    for (const name of readdirSync(cases)) {
      const dir = folder(t);
      spawnSync('bash', ['-e', join(cases, name, 'fixture.sh')], { cwd: dir, env: env(dir) });
      const tracked = git(dir, 'ls-files').stdout.split('\n').filter(Boolean);
      assert.ok(tracked.length > 0, `${trial}/${name}`);
      for (const path of tracked) {
        const file = path.split('/').pop();
        if (['README.md', 'RUNBOOK.md', 'CONTRIBUTING.md', '.gitignore', 'package.json', 'VERSION'].includes(file)) continue;
        banned.add(file.toLowerCase());
        // A document's name without its ending as well, such as the stem of a rule document.
        if (/\.md$/i.test(file)) banned.add(file.slice(0, -3).toLowerCase());
      }
      const [, client, partner] = readFileSync(join(dir, 'README.md'), 'utf8').match(maintains) || [];
      assert.ok(client, `${trial}/${name}`);
      banned.add(client.toLowerCase());
      if (partner) banned.add(partner.toLowerCase());
      banned.add(name);
    }
  }
  const shipped = [];
  const walk = d => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else shipped.push(p); } };
  walk(BUNDLE);
  for (const file of shipped) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const word of banned) assert.ok(!new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9]|$)`).test(text), `${file.slice(BUNDLE.length + 1)} names "${word}"`);
  }
  for (const word of ['ledgerline', 'tidewater', 'changing-production', 'maintaining', 'publishing', '0003-nightly-rollouts', 'pricing', 'queue-for-the-nightly-rollout']) {
    assert.ok(banned.has(word), word);
  }
  assert.ok(banned.size > 100, `${banned.size} names checked`);
  t.diagnostic(`${banned.size} names checked in ${shipped.length} shipped files`);
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
  assert.equal(manifest.version, '0.2.0');
  assert.equal(plugin.version, manifest.version);
  assert.deepEqual(manifest.modules, ['hook/operating-docs-notice']);
});
