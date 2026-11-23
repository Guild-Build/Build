// `test --unpublished`: a private folder of cases run as the unpublished part (hidden slice) of a published trial, `wrap`
// rebuilding its record, the `unpublished` command's count and checksum, and `submit` refusing such a record. Nothing here
// calls a model or the network: the CLI runs against a stub claude and a server on 127.0.0.1.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const MODEL = 'claude-sonnet-5-5';
const README = 'This synthetic trial stands in for a folder of unpublished cases without any model access or external network calls. Each case has one local task and one deterministic grader, with enough words to pass the normal trial checks. All executables are stubs.';
// The private cases, listed out of order; numbering follows their sorted names: alpha 1, middle 2, zeta 3.
const PRIVATE = [
  { name: 'zeta-secret-rollout', dimension: 'safety', score: 0.75, without: 0.25, prompt: 'Roll out zeta quietly.' },
  { name: 'alpha-secret-ledger', dimension: 'safety', score: 1, without: 0.5, prompt: 'Balance the alpha ledger.' },
  { name: 'middle-secret-handoff', dimension: 'handoff', score: 0.5, without: 0.5, prompt: 'Hand off the middle task.' },
];

async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'bg-unpublished-'));
  const write = (relative, contents, mode = 0o600) => {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents), { mode });
  };
  const published = { schema: 'buildguild.trial.v1', slug: 'sample-trial', name: 'Sample trial', version: '1.0.1', kind: 'guild', author: 'tester', license: 'Apache-2.0', summary: README, categories: ['delivery'],
    cases: [{ name: 'case-name', dimension: 'quality', runs: 1 }], tolerance: { overall: 0.1 }, hiddenSlice: { count: 0, published: null } };
  const folderTrial = (cases, slug = 'private-slice') => ({ schema: 'buildguild.trial.v1', slug, name: 'Private slice', version: '0.0.1', kind: 'guild', author: 'tester', license: 'Apache-2.0', summary: README, categories: ['delivery'],
    cases: cases.map(c => ({ name: c.name, dimension: c.dimension, runs: 1 })), tolerance: { overall: 0.1 } });
  // A trial folder in `dir` holding `cases`; written in the order given, so two folders can hold the same files made in different orders.
  const writeFolder = (dir, cases) => {
    write(`${dir}/trial.json`, folderTrial(cases));
    write(`${dir}/README.md`, README);
    write(`${dir}/LICENSE`, 'Apache-2.0');
    for (const c of cases) {
      write(`${dir}/cases/${c.name}/prompt.md`, `---\ntags: [${c.dimension}]\nallowed_tools: [Write]\n---\n${c.prompt}\n`);
      write(`${dir}/cases/${c.name}/graders/done.md`, "---\ntype: regex\npattern: 'done'\n---\n");
    }
  };
  write('build/buildguild.json', { slug: 'local-build', modules: [] });
  writeFolder('private-folder-q7', PRIVATE);
  // One case has a fixture script: `check` runs it, so a marker file shows whether a command ran the folder's fixtures.
  write('private-folder-q7/cases/zeta-secret-rollout/case.yaml', 'schema_version: "1.1"\nname: zeta-secret-rollout\ncontext:\n  scaffold_script: fixture.sh\n');
  write('private-folder-q7/cases/zeta-secret-rollout/fixture.sh', `echo ran >> ${JSON.stringify(join(root, 'fixture-ran'))}\n`, 0o755);
  // A stored ZIP holding cases/case-name/prompt.md with "Write done.\n", as tests/trial-repeats.test.mjs uses.
  const zip = Buffer.from('UEsDBBQAAAAAAAAAIVzncEO0DAAAAAwAAAAZAAAAY2FzZXMvY2FzZS1uYW1lL3Byb21wdC5tZFdyaXRlIGRvbmUuClBLAQIUAxQAAAAAAAAAIVzncEO0DAAAAAwAAAAZAAAAAAAAAAAAAACAAQAAAABjYXNlcy9jYXNlLW5hbWUvcHJvbXB0Lm1kUEsFBgAAAAABAAEARwAAAEMAAAAAAA==', 'base64');
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/trials/sample-trial.json') res.end(JSON.stringify({ ...published, archive: `${origin}/trial.zip` }));
    else if (req.url === '/trial.zip') res.end(zip);
    else res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  // The stub runner reports on whatever cases it finds in evals/, with each case's scores from PRIVATE (1 and 0 for others).
  const scores = Object.fromEntries(PRIVATE.map(c => [c.name, [c.score, c.without]]));
  write('bin/which', `#!${process.execPath}\nconst { accessSync, constants } = require('node:fs'); const p = require('node:path').join(process.env.PATH, process.argv[2]); try { accessSync(p, constants.X_OK); console.log(p); } catch { process.exit(1); }\n`, 0o700);
  // check runs a fixture with bash, the one real program the CLI may start besides the stubs.
  symlinkSync('/bin/bash', join(root, 'bin/bash'));
  write('bin/claude', `#!${process.execPath}
const { appendFileSync, readdirSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.322 (Claude Code)'); process.exit(0); }
if (args[0] !== 'plugin' || args[1] !== 'eval') process.exit(90);
const names = readdirSync('evals');
appendFileSync(${JSON.stringify(join(root, 'claude.log'))}, JSON.stringify({ args, cases: names }) + '\\n');
const scores = ${JSON.stringify(scores)};
const cases = names.map(name => { const [score, without] = scores[name] || [1, 0]; return { name, arms: { with: [{ score, error: null }], without: [{ score: without, error: null }] }, aggregates: { score, passRate: score === 1 ? 1 : 0, scoreWithout: without, passRateWithout: without === 1 ? 1 : 0, delta: score - without } }; });
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify({ schemaVersion: 1, claudeVersion: '2.1.322', durationSeconds: 5, costUsd: 0.3, partial: false, cases,
  aggregates: { casesTotal: cases.length, casesPassed: cases.filter(c => c.aggregates.score === 1).length, overallScore: mean(cases.map(c => c.aggregates.score)), meanDelta: mean(cases.map(c => c.aggregates.delta)) } }));
`, 0o700);
  const env = { PATH: join(root, 'bin'), HOME: root, BUILDGUILD_ORIGIN: `http://127.0.0.1:${server.address().port}` };
  const run = (argv, extraEnv = {}) => new Promise(resolve => execFile(process.execPath, [cli, ...argv], { cwd: root, env: { ...env, ...extraEnv }, timeout: 25000 },
    (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr })));
  const testRun = args => run(['test', './build', '--model', MODEL, '--runner', 'tester', '--work-dir', './work', ...args]);
  const json = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
  const claudeCalls = () => existsSync(join(root, 'claude.log')) ? readFileSync(join(root, 'claude.log'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, write, writeFolder, run, testRun, json, claudeCalls, requests };
}

// The checksum as the pull request tells a reader to recompute it by hand, with standard shell tools.
function shellChecksum(folder) {
  const script = `command -v sha256sum >/dev/null && H='sha256sum' || H='shasum -a 256'
cd "$1" && find cases -type f | LC_ALL=C sort | while IFS= read -r f; do case "$f" in *.sh) m=755;; *) m=644;; esac; printf '%s %s %s\\n' "$m" "$($H "$f" | cut -d' ' -f1)" "$f"; done | $H | cut -d' ' -f1`;
  const r = spawnSync('bash', ['-c', script, 'checksum', folder], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const digestOf = stdout => JSON.parse(stdout.match(/^unpublishedCases (.*)$/m)[1]);

test('each refusal comes with a plain message before anything is downloaded or run', async t => {
  const f = await setup(t);
  f.writeFolder('empty-folder', []);
  f.writeFolder('shared-name', [{ name: 'case-name', dimension: 'quality', prompt: 'Same name as a published case.' }, PRIVATE[1]]);
  f.writeFolder('broken-folder', [PRIVATE[1]]);
  f.write('broken-folder/README.md', 'Too short.');
  const refusals = [
    [['--trial', './private-folder-q7', '--unpublished', './private-folder-q7'], /--trial \.\/private-folder-q7 is a folder; with --unpublished, --trial names the published trial by its slug/],
    [['--unpublished', './private-folder-q7'], /--unpublished needs --trial <slug>, the published trial these cases are the unpublished part of; nothing was run/],
    [['--trial', 'sample-trial', '--unpublished', './empty-folder'], /empty-folder has no case: it needs at least one folder under cases\/ and the same names in trial\.json; nothing was run/],
    [['--trial', 'sample-trial', '--unpublished', './shared-name'], /a case in .*shared-name has the name of a case of the published trial sample-trial \(case-name\); rename it\. Nothing was run\./],
    [['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--role', 'author'], /--role must be guild or left out \(got "author"\); nothing was run/],
    [['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--role', 'assayer'], /--role must be guild or left out \(got "assayer"\)/],
    [['--trial', 'sample-trial', '--unpublished', './broken-folder'], /broken-folder: 1 problem\(s\)\n  - README\.md needs at least forty words/],
  ];
  for (const [args, message] of refusals) {
    const r = await f.testRun(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
  }
  assert.deepEqual(f.claudeCalls(), []);
  assert.ok(!existsSync(join(f.root, 'work')), 'the work dir was never made');
  assert.ok(!f.requests.some(u => u.endsWith('.zip')), 'no archive was downloaded');
});

test('only the folder\'s cases run, with the runner arguments of any other run, and the record names them only by number', async t => {
  const f = await setup(t);
  const normal = await f.testRun(['--trial', 'sample-trial']);
  assert.equal(normal.status, 0, normal.stderr + normal.stdout);
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-private.json', '--max-cost-usd', '2', '-j', '2']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const [first, second] = f.claudeCalls();
  assert.deepEqual(first.cases, ['case-name']);
  assert.deepEqual(second.cases.sort(), PRIVATE.map(c => c.name).sort(), 'the published case does not run, every folder case does');
  const sameButFlags = second.args.join(' ').replace('--max-cost-usd 2', '--max-cost-usd 5').replace(' -j 2', '');
  assert.equal(sameButFlags, first.args.join(' '), 'the runner gets the arguments of any other run');
  assert.ok(existsSync(join(f.root, 'fixture-ran')), 'test runs every check, fixtures included, as for a local trial folder');

  const record = f.json('evidence-unpublished.json');
  const digest = digestOf((await f.run(['unpublished', './private-folder-q7'])).stdout);
  assert.deepEqual(Object.keys(record), ['schema', 'id', 'build', 'buildVersion', 'archiveSha256', 'trial', 'trialVersion', 'hiddenSlice', 'date', 'runner', 'role', 'gist', 'environment', 'results', 'unpublishedCases', 'cost', 'durationSeconds']);
  assert.equal(record.schema, 'buildguild.evidence.v1');
  assert.equal(record.trial, 'sample-trial');
  assert.equal(record.trialVersion, '1.0.1', 'the published record\'s current version, not the folder\'s');
  assert.equal(record.hiddenSlice, true);
  assert.equal(record.role, 'guild');
  assert.equal(record.gist, null);
  assert.ok(!('trialSource' in record));
  assert.deepEqual(record.unpublishedCases, { count: 3, sha256: digest.sha256 });
  assert.match(record.unpublishedCases.sha256, /^[0-9a-f]{64}$/);
  // alpha 1, middle 2, zeta 3, whatever order they ran in; scores and gaps kept.
  assert.deepEqual(record.results.cases, [
    { name: 'unpublished-1', score: 1, delta: 0.5 },
    { name: 'unpublished-2', score: 0.5, delta: 0 },
    { name: 'unpublished-3', score: 0.75, delta: 0.5 },
  ]);
  assert.equal(record.results.overallScore, 0.75);
  assert.equal(record.results.casesPassed, 1);
  assert.equal(record.results.casesTotal, 3);
  assert.equal(record.results.bareOverallScore, (0.5 + 0.5 + 0.25) / 3, 'the mean of each case\'s scoreWithout');
  // Dimensions from the folder's trial.json, as wrap computes them: safety is alpha and zeta, handoff is middle.
  assert.deepEqual(record.results.dimensions, { safety: 0.875, handoff: 0.5, cost: 0.85 });
  assert.equal(record.environment.model, MODEL);

  // Nothing private: no case name, prompt, folder name or path.
  const text = readFileSync(join(f.root, 'evidence-unpublished.json'), 'utf8');
  for (const secret of [...PRIVATE.flatMap(c => [c.name, c.prompt]), 'private-folder-q7', 'private-slice', f.root, 'fixture.sh']) assert.ok(!text.includes(secret), `the record holds ${secret}`);
  assert.deepEqual(text.match(/unpublished-\d+/g), ['unpublished-1', 'unpublished-2', 'unpublished-3']);

  // One warning names the private outputs; the raw report is marked and keeps the run's facts for wrap.
  const warnings = r.stderr.split('\n').filter(l => l.startsWith('warning:'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^warning: private files\. The run folder .*work, its raw report .*buildguild-raw\.json, the copy .*raw-private\.json hold the unpublished cases' names and prompts\. Do not commit, upload or paste them anywhere\./);
  const raw = f.json('raw-private.json');
  assert.equal(raw.trialSource, 'unpublished');
  assert.deepEqual(raw.unpublishedRun, { trial: 'sample-trial', trialVersion: '1.0.1', count: 3, sha256: digest.sha256, modules: [] });
  assert.deepEqual(f.json('work/buildguild-raw.json'), raw);
  assert.match(r.stdout, /hidden-slice record: .*evidence-unpublished\.json\n  overall 75%, \+33 pts over bare, 1\/3 cases, est\. \$0\.3; bare runtime 42%\nIt names the cases only as unpublished-1 to unpublished-3\. A maintainer adds it to Build by pull request; submit refuses it\./);
});

test('--role guild is accepted, and --out and --rep work as in any run', async t => {
  const f = await setup(t);
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--role', 'guild', '--rep', '2']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(f.json('evidence-unpublished-rep2.json').id, /-rep2$/);
  const named = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--out', 'slice.json']);
  assert.equal(named.status, 0, named.stderr + named.stdout);
  assert.equal(f.json('slice.json').hiddenSlice, true);
});

test('the checksum ignores the folder\'s path, file times, file modes and creation order, and follows every byte and name', async t => {
  const f = await setup(t);
  const sumOf = async dir => { const r = await f.run(['unpublished', dir]); assert.equal(r.status, 0, r.stderr); return digestOf(r.stdout); };
  const base = await sumOf('./private-folder-q7');
  assert.equal(base.count, 3);
  assert.ok(!existsSync(join(f.root, 'fixture-ran')), 'the unpublished command runs no fixture');
  assert.deepEqual(f.claudeCalls(), []);
  assert.equal(base.sha256, shellChecksum(join(f.root, 'private-folder-q7')), 'the by-hand recipe gives the same checksum');

  // A copy elsewhere, with other times and modes.
  const elsewhere = mkdtempSync(join(tmpdir(), 'bg-unpublished-copy-'));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  cpSync(join(f.root, 'private-folder-q7'), join(elsewhere, 'renamed'), { recursive: true });
  utimesSync(join(elsewhere, 'renamed/cases/alpha-secret-ledger/prompt.md'), new Date('2001-01-01'), new Date('2001-01-01'));
  chmodSync(join(elsewhere, 'renamed/cases/zeta-secret-rollout/fixture.sh'), 0o600);
  chmodSync(join(elsewhere, 'renamed/cases/alpha-secret-ledger/prompt.md'), 0o755);
  assert.deepEqual(await sumOf(join(elsewhere, 'renamed')), base);

  // The same files created in the reverse order.
  f.writeFolder('reversed', [...PRIVATE].reverse());
  f.write('reversed/cases/zeta-secret-rollout/fixture.sh', `echo ran >> ${JSON.stringify(join(f.root, 'fixture-ran'))}\n`, 0o755);
  f.write('reversed/cases/zeta-secret-rollout/case.yaml', 'schema_version: "1.1"\nname: zeta-secret-rollout\ncontext:\n  scaffold_script: fixture.sh\n');
  assert.deepEqual(await sumOf('./reversed'), base);

  // One byte more, or a renamed file, is another checksum.
  f.write('reversed/cases/alpha-secret-ledger/prompt.md', readFileSync(join(f.root, 'reversed/cases/alpha-secret-ledger/prompt.md'), 'utf8') + ' ');
  const changed = await sumOf('./reversed');
  assert.notEqual(changed.sha256, base.sha256);
  assert.equal(changed.sha256, shellChecksum(join(f.root, 'reversed')));
  cpSync(join(f.root, 'private-folder-q7'), join(f.root, 'moved'), { recursive: true });
  rmSync(join(f.root, 'moved/cases/alpha-secret-ledger/graders/done.md'));
  f.write('moved/cases/alpha-secret-ledger/graders/finished.md', "---\ntype: regex\npattern: 'done'\n---\n");
  assert.notEqual((await sumOf('./moved')).sha256, base.sha256);
});

test('a folder with the same bytes has the same checksum on every platform', async t => {
  const f = await setup(t);
  // Nothing in this folder depends on where the test runs, so CI on Linux and a run on macOS must print the same value.
  f.writeFolder('fixed', PRIVATE);
  f.write('fixed/cases/middle-secret-handoff/setup.sh', 'true\n', 0o644);
  const r = await f.run(['unpublished', './fixed']);
  assert.equal(r.status, 0, r.stderr);
  const FIXED = '9690185489a9997719ce2a6d208062a056363c1da5ba8b87e57155e1321c75c9';
  assert.deepEqual(digestOf(r.stdout), { count: 3, sha256: FIXED });
  assert.equal(shellChecksum(join(f.root, 'fixed')), FIXED);
  assert.equal(r.stdout, `3 unpublished cases\nsha256 ${FIXED}\nunpublishedCases {"count":3,"sha256":"${FIXED}"}\n`);
});

test('wrap --unpublished rebuilds the same record from the saved raw report, and wrap refuses it any other way', async t => {
  const f = await setup(t);
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-private.json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const wrapArgs = ['wrap', 'raw-private.json', '--model', MODEL, '--build', 'local-build', '--runner', 'tester'];
  const w = await f.run([...wrapArgs, '--trial', 'sample-trial', '--unpublished', './private-folder-q7']);
  assert.equal(w.status, 0, w.stderr);
  const fromTest = f.json('evidence-unpublished.json');
  const fromWrap = JSON.parse(w.stdout);
  assert.notEqual(fromWrap.id, fromTest.id);
  assert.equal(JSON.stringify({ ...fromWrap, id: null }), JSON.stringify({ ...fromTest, id: null }));

  const refusals = [
    [[...wrapArgs, '--trial', 'sample-trial'], /raw-private\.json is the report of a run on unpublished cases; wrap it with --unpublished <the same folder> --trial <the published slug>/],
    [[...wrapArgs, '--trial', './private-folder-q7'], /raw-private\.json is the report of a run on unpublished cases/],
    [[...wrapArgs, '--trial', './private-folder-q7', '--unpublished', './private-folder-q7'], /--trial \.\/private-folder-q7 is a folder/],
    [[...wrapArgs, '--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--role', 'author'], /--role must be guild or left out/],
    [[...wrapArgs, '--trial', 'other-trial', '--unpublished', './private-folder-q7'], /raw-private\.json is a run on unpublished cases of sample-trial, not of other-trial/],
  ];
  for (const [args, message] of refusals) {
    const result = await f.run(args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, message, args.join(' '));
  }
  // A report of an ordinary run is not one with --unpublished.
  writeFileSync(join(f.root, 'raw-plain.json'), JSON.stringify({ ...f.json('raw-private.json'), trialSource: undefined, unpublishedRun: undefined }));
  const plain = await f.run(['wrap', 'raw-plain.json', '--model', MODEL, '--build', 'local-build', '--trial', 'sample-trial', '--unpublished', './private-folder-q7']);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /raw-plain\.json is not the report of a run with --unpublished, so it cannot become a hidden-slice record/);
  // The folder changed since the run.
  f.write('private-folder-q7/cases/alpha-secret-ledger/prompt.md', '---\ntags: [safety]\nallowed_tools: [Write]\n---\nBalance the ledger twice.\n');
  const changed = await f.run([...wrapArgs, '--trial', 'sample-trial', '--unpublished', './private-folder-q7']);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /private-folder-q7 no longer holds the cases that run used \(it has 3 with sha256 [0-9a-f]{64}; the run had 3 with sha256 [0-9a-f]{64}\); no record was written/);
});

test('submit refuses a hidden-slice record before it looks for gh', async t => {
  const f = await setup(t);
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const record = f.json('evidence-unpublished.json');
  writeFileSync(join(f.root, 'count-only.json'), JSON.stringify({ ...record, hiddenSlice: undefined }));
  for (const file of ['evidence-unpublished.json', 'count-only.json']) {
    const s = await f.run(['submit', file, '--yes']);
    assert.equal(s.status, 1, file);
    assert.equal(s.stderr, `buildguild: ${file} is a run on a trial's unpublished cases (a hidden-slice record). A maintainer adds it to Build by pull request; it is never sent as a Gist. Nothing was sent.\n`);
  }
  assert.ok(!f.requests.some(u => u.startsWith('/api/')), 'nothing was posted');
});

test('the help text names the mode and the checksum command', () => {
  const r = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /test <slug\|path> --trial <published-slug> --unpublished <trial-folder> --model <id>/);
  assert.match(r.stdout, /node cli\/buildguild\.mjs unpublished <trial-folder>/);
  assert.match(r.stdout, /refuses a local run and a hidden-slice record/);
  assert.match(readFileSync(fileURLToPath(new URL('../cli/README.md', import.meta.url)), 'utf8'), /## Run unpublished cases as a hidden slice/);
});

test('the unpublished command refuses a folder that is not one of cases', async t => {
  const f = await setup(t);
  f.writeFolder('empty-folder', []);
  for (const [args, message] of [
    [['unpublished'], /usage: buildguild unpublished <trial-folder>/],
    [['unpublished', './missing'], /no trial folder at .*missing; nothing was run/],
    [['unpublished', './build'], /build has no trial\.json, so it is not a trial folder; nothing was run/],
    [['unpublished', './empty-folder'], /has no case/],
  ]) {
    const r = await f.run(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, message);
  }
  assert.deepEqual(readdirSync(f.root).filter(n => n === 'claude.log'), []);
});
