// `test --unpublished`: a private folder of cases run as the unpublished part (hidden slice) of a published trial, `wrap`
// rebuilding its record, the `unpublished` command's count and checksum, and `submit` refusing such a record. Nothing here
// calls a model or the network: the CLI runs against a stub claude and a server on 127.0.0.1.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const MODEL = 'claude-sonnet-5-5';
const README = 'This synthetic trial stands in for a folder of unpublished cases without any model access or external network calls. Each case has one local task and one deterministic grader, with enough words to pass the normal trial checks. All executables are stubs.';
// The private cases, listed out of order; numbering follows their sorted names: alpha 1, middle 2, zeta 3.
const PRIVATE = [
  { name: 'zeta-secret-rollout', dimension: 'safety', score: 0.75, without: 0.25, prompt: 'Roll out zeta quietly.' },
  { name: 'alpha-secret-ledger', dimension: 'safety', score: 1, without: 0.5, prompt: 'Balance the alpha ledger.' },
  { name: 'middle-secret-handoff', dimension: 'handoff', score: 0.5, without: 0.5, prompt: 'Hand off the middle task.' },
];

// Two names whose byte order and locale order differ: 'B-…' before 'a-…' by bytes, after it in most locales.
const MIXED = [
  { name: 'c-lower-gauge', dimension: 'quality', score: 0.5, without: 0.5, prompt: 'Read the c gauge.' },
  { name: 'a-lower-ledger', dimension: 'handoff', score: 1, without: 0.5, prompt: 'Close the a ledger.' },
  { name: 'B-upper-switch', dimension: 'safety', score: 0.75, without: 0.25, prompt: 'Flip the B switch.' },
];

// A stored (uncompressed) zip of { name: contents }, enough for the CLI's own reader, for the published build's archive.
function zipOf(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const data = Buffer.from(contents), n = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const BUILD_FILES = { 'local-build/buildguild.json': JSON.stringify({ slug: 'local-build', modules: [] }), 'local-build/README.md': 'A stand-in build for the tests.\n' };
const BUILD_ZIP = zipOf(BUILD_FILES);
const BUILD_SHA = createHash('sha256').update(BUILD_ZIP).digest('hex');

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
  // The stub site: the published trial and its archive, and published builds with their archives. A test may add routes.
  const routes = {};
  const server = createServer((req, res) => {
    requests.push(req.url);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const build = (slug, zip) => ({ slug, name: slug, version: '0.1.0', archive: zip ? { file: `${slug}-0.1.0.zip`, url: `${origin}/dl/${slug}.zip`, sha256: createHash('sha256').update(zip).digest('hex') } : null });
    if (req.url === '/trials/sample-trial.json') res.end(JSON.stringify({ ...published, archive: `${origin}/trial.zip` }));
    else if (req.url === '/trial.zip') res.end(zip);
    else if (req.url === '/builds/local-build.json') res.end(JSON.stringify(build('local-build', BUILD_ZIP)));
    else if (req.url === '/dl/local-build.zip') res.end(BUILD_ZIP);
    else if (req.url === '/builds/no-archive-build.json') res.end(JSON.stringify(build('no-archive-build', null)));
    else if (routes[req.url]) { const r = routes[req.url]; res.end(typeof r === 'function' ? r(build) : r); }
    else res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  // The stub runner reports on whatever cases it finds in evals/, with each case's scores from PRIVATE (1 and 0 for others).
  const scores = Object.fromEntries([...PRIVATE, ...MIXED].map(c => [c.name, [c.score, c.without]]));
  write('bin/which', `#!${process.execPath}\nconst { accessSync, constants } = require('node:fs'); const p = require('node:path').join(process.env.PATH, process.argv[2]); try { accessSync(p, constants.X_OK); console.log(p); } catch { process.exit(1); }\n`, 0o700);
  // check runs a fixture with bash, the one real program the CLI may start besides the stubs.
  symlinkSync('/bin/bash', join(root, 'bin/bash'));
  write('bin/claude', `#!${process.execPath}
const { appendFileSync, readdirSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.322 (Claude Code)'); process.exit(0); }
if (args[0] !== 'plugin' || args[1] !== 'eval') process.exit(90);
const damage = (process.env.STUB_DAMAGE || '').split(',').filter(Boolean);
if (damage.includes('no-report')) process.exit(90);
const names = readdirSync('evals').sort();
appendFileSync(${JSON.stringify(join(root, 'claude.log'))}, JSON.stringify({ args, cases: names }) + '\\n');
const scores = ${JSON.stringify(scores)};
// An attempt as the runner reports it: every grader of the case, scored, and no paid grader skipped.
const graded = (name, score) => ({ score, passed: score >= 1, error: null, skippedPaidGraders: false,
  graders: (require('node:fs').existsSync(require('node:path').join('evals', name, 'graders')) ? readdirSync(require('node:path').join('evals', name, 'graders')) : []).filter(n => n.endsWith('.md')).sort().map(n => ({ name: n.slice(0, -3), passed: score >= 1, weight: 1, explanation: '', withOnly: false, scored: true })) });
let cases = names.map(name => { const [score, without] = scores[name] || [1, 0]; return { name, runsPerCase: 1, arms: { with: [graded(name, score)], without: [graded(name, without)] }, aggregates: { score, passRate: score === 1 ? 1 : 0, scoreWithout: without, passRateWithout: without === 1 ? 1 : 0, delta: score - without } }; });
const failed = { score: null, error: 'synthetic runner error' };
if (damage.includes('aborted')) cases[0].arms.with[0].aborted = true;
if (damage.includes('unscored')) cases[0].arms.with[0].graders[0].scored = false;
if (damage.includes('with-only')) cases[0].arms.without[0].graders[0] = { ...cases[0].arms.without[0].graders[0], withOnly: true, scored: false };
if (damage.includes('short-runs')) cases[0].runsPerCase = 2;
if (damage.includes('arm-error')) { cases[0].arms.without = [failed]; cases[0].aggregates.scoreWithout = null; }
if (damage.includes('no-score')) cases[0].arms.with = [{ score: null, error: null }];
if (damage.includes('extra-run')) cases[0].arms.without.push(graded(cases[0].name, cases[0].aggregates.scoreWithout));
if (damage.includes('all-error')) for (const c of cases) { c.arms = { with: [failed], without: [failed] }; c.aggregates = { score: null, passRate: 0, scoreWithout: null, passRateWithout: 0, delta: null }; }
if (damage.includes('duplicate')) cases[1] = JSON.parse(JSON.stringify(cases[0]));
if (damage.includes('drop')) cases = cases.slice(1);
if (damage.includes('bad-delta')) cases[0].aggregates.delta += 0.125;
const mean = xs => { const n = xs.filter(x => typeof x === 'number'); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; };
const aggregates = { casesTotal: cases.length, casesPassed: cases.filter(c => c.aggregates.score === 1).length, overallScore: mean(cases.map(c => c.aggregates.score)), meanDelta: mean(cases.map(c => c.aggregates.delta)) };
if (damage.includes('bad-total')) aggregates.casesTotal += 1;
if (damage.includes('bad-overall')) aggregates.overallScore += 0.125;
if (damage.includes('skipped-graders')) cases[0].arms.with[0].skippedPaidGraders = true;
const suite = { ablation: damage.includes('no-ablation') ? 'none' : args[args.indexOf('--ablation') + 1], modelOverride: damage.includes('other-model') ? 'claude-haiku-5-5' : args[args.indexOf('--model') + 1] };
writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify({ schemaVersion: 1, claudeVersion: '2.1.322', durationSeconds: 5, costUsd: 0.3, partial: damage.includes('partial'), suite, cases, aggregates }));
if (damage.includes('exit-2')) process.exit(2);
`, 0o700);
  const env = { PATH: join(root, 'bin'), HOME: root, BUILDGUILD_ORIGIN: `http://127.0.0.1:${server.address().port}` };
  const run = (argv, extraEnv = {}) => new Promise(resolve => execFile(process.execPath, [cli, ...argv], { cwd: root, env: { ...env, ...extraEnv }, timeout: 25000 },
    (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr })));
  const testRun = (args, extraEnv) => run(['test', 'local-build', '--model', MODEL, '--runner', 'tester', '--work-dir', './work', ...args], extraEnv);
  const json = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
  const claudeCalls = () => existsSync(join(root, 'claude.log')) ? readFileSync(join(root, 'claude.log'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, write, writeFolder, run, testRun, json, claudeCalls, requests, routes };
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
  assert.deepEqual(raw.unpublishedRun, { trial: 'sample-trial', trialVersion: '1.0.1', count: 3, sha256: digest.sha256,
    cases: PRIVATE.map(c => ({ name: c.name, dimension: c.dimension, graders: ['done'] })), build: 'local-build', buildVersion: '0.1.0', archiveSha256: BUILD_SHA, runner: 'tester',
    date: record.date, idSuffix: '', environment: record.environment });
  assert.equal(record.buildVersion, '0.1.0');
  assert.equal(record.archiveSha256, BUILD_SHA);
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
  assert.match(r.stdout, /test <published-build> --trial <published-slug> --unpublished <trial-folder> --model <id> --runner <login>/);
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

// ---------- review 6030797971 ----------
const wrapOf = (raw, extra = []) => ['wrap', raw, '--model', MODEL, '--trial', 'sample-trial', '--unpublished', './private-folder-q7', ...extra];
const withoutId = record => JSON.stringify({ ...record, id: record.id.replace(/-[a-z0-9]{1,6}(-rep\d+)?$/, '$1') });

// Finding 1: in this mode a record is written only for a complete run; the raw report is still saved, marked.
// Cases sort as alpha (unpublished-1), middle (2), zeta (3); the stub damages the first, alpha.
const DAMAGES = [
  ['partial', 'the run is partial: it stopped before every case had run'],
  ['arm-error', 'unpublished-1: a run of the bare runtime ended in an error or was aborted (synthetic runner error)'],
  ['no-score', 'unpublished-1: a run with the build was not fully graded (a grader that counts went unscored, its graders are not the case\'s, its score is not from 0 to 1, or paid graders were skipped)'],
  ['extra-run', 'unpublished-1: 2 runs of the bare runtime, where the case declares 1'],
  ['duplicate', 'the report holds more than one result for unpublished-1'],
  ['drop', 'the report holds no result for unpublished-1'],
  ['bad-total', 'the report counts 4 cases and lists 3, and the folder has 3'],
  ['bad-overall', 'the overall score 0.875 is not the mean of the case scores'],
  ['bad-delta', 'unpublished-1: its gap 0.625 is not its score minus its bare score'],
  // Found on a second look: the report also says which model ran, whether both arms ran, and whether a grader was skipped.
  ['other-model', 'the runner ran claude-haiku-5-5, not claude-sonnet-5-5'],
  ['no-ablation', 'the run did not compare the build with the bare runtime (ablation "none")'],
  ['skipped-graders', 'unpublished-1: a run with the build was not fully graded (a grader that counts went unscored, its graders are not the case\'s, its score is not from 0 to 1, or paid graders were skipped)'],
  // Review 6031210034, finding 3: an aborted run, and a run that left a grader that counts unscored, are incomplete.
  ['aborted', 'unpublished-1: a run with the build ended in an error or was aborted'],
  ['unscored', 'unpublished-1: a run with the build was not fully graded (a grader that counts went unscored, its graders are not the case\'s, its score is not from 0 to 1, or paid graders were skipped)'],
  // Finding 1: each arm holds exactly the runs its case declares, no more and no fewer.
  ['short-runs', 'unpublished-1: 1 runs with the build, where the case declares 2'],
];

test('test --unpublished writes no record for a run that is not complete, and keeps the raw report, marked', async t => {
  const f = await setup(t);
  for (const [damage, problem] of DAMAGES) {
    const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', `raw-${damage}.json`], { STUB_DAMAGE: damage });
    assert.equal(r.status, 2, `${damage}: ${r.stderr}`);
    assert.ok(r.stderr.includes('buildguild: no record was written: the run on the unpublished cases is not complete.\n'), `${damage}: ${r.stderr}`);
    assert.ok(r.stderr.includes(`\n  - ${problem}\n`), `${damage}: ${r.stderr}`);
    assert.match(r.stderr, /The raw report .*buildguild-raw\.json and its copy .*raw-[a-z-]+\.json are kept, marked, to work out what happened; they hold the cases' names and prompts, so keep them private\./);
    assert.ok(!existsSync(join(f.root, 'evidence-unpublished.json')), `${damage}: no record`);
    const raw = f.json(`raw-${damage}.json`);
    assert.equal(raw.trialSource, 'unpublished');
    assert.equal(raw.unpublishedRun.count, 3);
  }
  // Every arm in error; the report is still kept, marked.
  const all = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-all-error.json'], { STUB_DAMAGE: 'all-error' });
  assert.equal(all.status, 2);
  assert.match(all.stderr, /no record was written: the run on the unpublished cases is not complete\.\n  - unpublished-1: a run with the build ended in an error or was aborted \(synthetic runner error\)/);
  assert.equal(f.json('raw-all-error.json').trialSource, 'unpublished');
  assert.ok(!existsSync(join(f.root, 'evidence-unpublished.json')));
});

test('an ordinary run with the same damage behaves as it always has', async t => {
  const f = await setup(t);
  const partial = await f.testRun(['--trial', 'sample-trial'], { STUB_DAMAGE: 'partial' });
  assert.equal(partial.status, 0, partial.stderr);
  assert.equal(f.json('evidence.json').results.partial, true);
  assert.match(partial.stdout, /\(PARTIAL: cost ceiling hit\)/);
  const errored = await f.testRun(['--trial', 'sample-trial', '--out', 'errored.json'], { STUB_DAMAGE: 'arm-error' });
  assert.equal(errored.status, 0, errored.stderr);
  assert.match(errored.stderr, /note: 1 of 2 agent runs ended in an error; first: synthetic runner error/);
  assert.equal(f.json('errored.json').results.cases[0].name, 'case-name');
});

// Finding 2: wrap --unpublished runs the same checks, from the same function.
test('wrap --unpublished refuses a report that is not complete, by the same checks as test', async t => {
  const f = await setup(t);
  for (const [damage, problem] of DAMAGES) {
    await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', `raw-${damage}.json`], { STUB_DAMAGE: damage });
    const w = await f.run(wrapOf(`raw-${damage}.json`));
    assert.equal(w.status, 1, `${damage}: ${w.stdout}`);
    assert.ok(w.stderr.startsWith(`buildguild: no record was written: raw-${damage}.json is not the report of a complete run on the unpublished cases.\n`), `${damage}: ${w.stderr}`);
    assert.ok(w.stderr.includes(`\n  - ${problem}`), `${damage}: ${w.stderr}`);
    assert.equal(w.stdout, '');
  }
  // The reviewer's case: every arm in error. test writes no record; wrap of its saved report writes none either.
  await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-all-error.json'], { STUB_DAMAGE: 'all-error' });
  const w = await f.run(wrapOf('raw-all-error.json'));
  assert.equal(w.status, 1);
  assert.match(w.stderr, /unpublished-1: a run with the build ended in an error or was aborted \(synthetic runner error\)/);
  assert.equal(w.stdout, '');
});

// Finding 3: trial.json lists each case once, its list is the folders under cases/, and the report has one result for each.
test('a case listed twice in trial.json is refused by unpublished, test and wrap alike', async t => {
  const f = await setup(t);
  const good = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-good.json']);
  assert.equal(good.status, 0, good.stderr);
  const trialJson = join(f.root, 'private-folder-q7/trial.json');
  const record = JSON.parse(readFileSync(trialJson, 'utf8'));
  writeFileSync(trialJson, JSON.stringify({ ...record, cases: [...record.cases, record.cases[1]] }));
  const message = /private-folder-q7\/trial\.json lists alpha-secret-ledger more than once; each case is listed once\. Nothing was run\./;
  const calls = f.claudeCalls().length;
  for (const args of [['unpublished', './private-folder-q7'], wrapOf('raw-good.json')]) {
    const r = await f.run(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, message);
    assert.equal(r.stdout, '');
  }
  rmSync(join(f.root, 'fixture-ran'), { force: true });
  const run = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, message);
  assert.equal(f.claudeCalls().length, calls, 'nothing ran');
  assert.ok(!existsSync(join(f.root, 'fixture-ran')), 'no fixture ran');
});

// Finding 4: the marker keeps each case's dimension at the run; wrap uses it and says when trial.json now differs.
test('wrap keeps the dimensions the cases had at the run, and says so when trial.json has changed', async t => {
  const f = await setup(t);
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-private.json']);
  assert.equal(r.status, 0, r.stderr);
  const fromTest = f.json('evidence-unpublished.json');
  const trialJson = join(f.root, 'private-folder-q7/trial.json');
  const record = JSON.parse(readFileSync(trialJson, 'utf8'));
  writeFileSync(trialJson, JSON.stringify({ ...record, cases: record.cases.map(c => c.name === 'zeta-secret-rollout' ? { ...c, dimension: 'quality' } : c) }));
  const w = await f.run(wrapOf('raw-private.json'));
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stderr, /note: .*private-folder-q7\/trial\.json now gives unpublished-3 the dimension quality; the record keeps safety, its dimension at the run\n/);
  const fromWrap = JSON.parse(w.stdout);
  assert.deepEqual(fromWrap.results.dimensions, { safety: 0.875, handoff: 0.5, cost: 0.85 });
  assert.equal(withoutId(fromWrap), withoutId(fromTest));
});

// Review 6031210034, finding 5, and the review before it: one preflight makes every check that needs nothing to run. Each row is
// one refusal; for each, the folder's fixture did not run, the work folder is untouched, no archive was fetched and no file was
// written or changed. Every refusal the CLI names (refuse('<why>', …), or lookUp(…, '<why>', …)) must have a row here.
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function snapshot(dir) {
  const files = {};
  const walk = rel => {
    for (const name of readdirSync(join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, r));
      if (st.isSymbolicLink()) files[r] = `link:${readlinkSync(join(dir, r))}`;
      else if (st.isDirectory()) { files[`${r}/`] = 'dir'; walk(r); }
      else files[r] = sha(join(dir, r));
    }
  };
  walk('');
  return files;
}
test('every refusal of the preflight runs, deletes, downloads and writes nothing, and every named refusal has a row', async t => {
  const f = await setup(t);
  const marker = join(f.root, 'refused-fixture-ran');
  const withFixture = (dir, cases) => {
    f.writeFolder(dir, cases);
    f.write(`${dir}/cases/${cases[0].name}/case.yaml`, `schema_version: "1.1"\nname: ${cases[0].name}\ncontext:\n  scaffold_script: fixture.sh\n`);
    f.write(`${dir}/cases/${cases[0].name}/fixture.sh`, `echo ran >> ${JSON.stringify(marker)}\n`, 0o755);
  };
  // Folders, each with a fixture that would leave the marker if anything ran it.
  withFixture('good', [PRIVATE[1], PRIVATE[2]]);
  withFixture('shared', [{ name: 'case-name', dimension: 'quality', prompt: 'Same name as a published case.' }, PRIVATE[1]]);
  withFixture('short-readme', [PRIVATE[1]]); f.write('short-readme/README.md', 'Too short.');
  withFixture('twice', [PRIVATE[1], PRIVATE[2]]); f.write('twice/trial.json', JSON.stringify({ ...f.json('twice/trial.json'), cases: [PRIVATE[1], PRIVATE[2], PRIVATE[2]].map(c => ({ name: c.name, dimension: c.dimension, runs: 1 })) }));
  withFixture('unnamed', [PRIVATE[1]]); f.write('unnamed/trial.json', JSON.stringify({ ...f.json('unnamed/trial.json'), cases: [{ dimension: 'safety', runs: 1 }] }));
  withFixture('mismatch', [PRIVATE[1]]); f.write('mismatch/trial.json', JSON.stringify({ ...f.json('mismatch/trial.json'), cases: [PRIVATE[1], PRIVATE[2]].map(c => ({ name: c.name, dimension: c.dimension, runs: 1 })) }));
  withFixture('bad-json', [PRIVATE[1]]); f.write('bad-json/trial.json', '{ not json');
  withFixture('line-break', [PRIVATE[1]]); f.write(`line-break/cases/${PRIVATE[1].name}/notes\n.txt`, 'a name with a line break');
  f.writeFolder('empty', []);
  mkdirSync(join(f.root, 'no-trial'));
  // The reviewer's aliases: the default record path and a link out of the folder; a raw-report link onto the record path.
  symlinkSync(join(f.root, 'good/cases', PRIVATE[1].name, 'prompt.md'), join(f.root, 'link-to-prompt.json'));
  // For the work-dir guard: a folder outside this one, so only the guard refuses (--work-dir ., here the home directory too).
  const elsewhere = mkdtempSync(join(tmpdir(), 'bg-unpublished-elsewhere-'));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  cpSync(join(f.root, 'good'), join(elsewhere, 'good'), { recursive: true });
  mkdirSync(join(f.root, 'bin-no-claude'));
  cpSync(join(f.root, 'bin/which'), join(f.root, 'bin-no-claude/which'));
  symlinkSync('/bin/bash', join(f.root, 'bin-no-claude/bash'));
  f.routes['/builds/unreadable-build.json'] = '{ not json';
  f.write('work/keep.txt', 'kept');
  const base = ['--model', MODEL, '--runner', 'tester', '--work-dir', './work'];
  const run = (build, folder, extra = [], env) => f.run(['test', ...(build ? [build] : []), '--trial', 'sample-trial', '--unpublished', folder, ...base, ...extra], env);
  const ROWS = [
    ['flag', () => run('local-build', './good', ['--runs', '3']), /--runs is not accepted by test --unpublished: the number of runs is part of each case, which the checksum fixes\. It accepts --trial, --unpublished/],
    ['flag', () => run('local-build', './good', ['--no-fixtures']), /--no-fixtures is not accepted by test --unpublished: every unpublished folder gets the fixture check/],
    ['flag', () => run('local-build', './good', ['--out', 'a.json', '--out', 'b.json']), /--out is given twice; nothing was run/],
    ['flag-value', () => run('local-build', './good', ['--out', '--keep-temp']), /--out needs a value; nothing was run/],
    ['flag-value', () => run('local-build', './good', ['-j', '9']), /-j needs a whole number from 1 to 8, as the runner takes, not "9"/],
    ['flag-value', () => run('local-build', './good', ['--max-cost-usd', 'lots']), /--max-cost-usd needs a positive number of USD, not "lots"/],
    ['model', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--runner', 'tester', '--work-dir', './work']), /test needs --model <id>/],
    ['rep', () => run('local-build', './good', ['--rep', '0']), /--rep needs a whole number of at least 1; nothing was run/],
    ['runner', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--work-dir', './work']), /with --unpublished, --runner names the GitHub login the record credits/],
    ['runner', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'not_a_login', '--work-dir', './work']), /--runner names the GitHub login the record credits \(letters, digits and hyphens\), not "not_a_login"/],
    ['role', () => run('local-build', './good', ['--role', 'author']), /--role must be guild or left out \(got "author"\); nothing was run/],
    ['trial-missing', () => f.run(['test', 'local-build', '--unpublished', './good', ...base]), /--unpublished needs --trial <slug>/],
    ['trial-folder', () => f.run(['test', 'local-build', '--trial', './good', '--unpublished', './good', ...base]), /--trial \.\/good is a folder/],
    ['trial-slug', () => f.run(['test', 'local-build', '--trial', 'Not_A_Slug', '--unpublished', './good', ...base]), /--trial "Not_A_Slug" is not a kebab-case slug/],
    ['build-missing', () => run(null, './good'), /usage: buildguild test <published-build>/],
    ['build-folder', () => run('./build', './good'), /\.\/build is a path here; with --unpublished the build is a published build, named by its slug/],
    ['build-slug', () => run('INVALID', './good'), /build must be a kebab-case slug, got "INVALID"; nothing was run/],
    ['folder-absent', () => run('local-build', './missing'), /no trial folder at .*missing; nothing was run/],
    ['folder-no-trial', () => run('local-build', './no-trial'), /no-trial has no trial\.json, so it is not a trial folder/],
    ['folder-json', () => run('local-build', './bad-json'), /bad-json\/trial\.json is not valid JSON/],
    ['folder-no-case', () => run('local-build', './empty'), /empty has no case/],
    ['roster-name', () => run('local-build', './unnamed'), /unnamed\/trial\.json lists a case without a name/],
    ['roster-twice', () => run('local-build', './twice'), /twice\/trial\.json lists middle-secret-handoff more than once/],
    ['roster-mismatch', () => run('local-build', './mismatch'), /mismatch\/trial\.json lists 2 cases and cases\/ holds 1 folders/],
    ['structure', () => run('local-build', './short-readme'), /short-readme: 1 problem\(s\)\n  - README\.md needs at least forty words/],
    ['file-name', () => run('local-build', './line-break'), /a file name under .*line-break\/cases holds a line break/],
    ['output-link', () => run('local-build', './good', ['--out', 'link-to-prompt.json']), /--out .*link-to-prompt\.json is a link/],
    ['output-link', () => run('local-build', './good', [], undefined, symlinkSync(join(f.root, 'link-to-prompt.json'), join(f.root, 'evidence-unpublished.json'))), /--out .*evidence-unpublished\.json is a link/],
    ['output-in-folder', () => run('local-build', './good', ['--out', `./good/cases/${PRIVATE[1].name}/prompt.md`]), /--out .*prompt\.md is inside the unpublished folder/],
    ['output-in-folder', () => run('local-build', './good', ['--raw-out', './good/raw.json']), /--raw-out .*good\/raw\.json is inside the unpublished folder/],
    ['output-same', () => run('local-build', './good', ['--out', 'same.json', '--raw-out', 'same.json']), /--raw-out and --out are the same path/],
    ['output-in-work-dir', () => run('local-build', './good', ['--raw-out', './work/raw.json']), /--raw-out .*work\/raw\.json is inside --work-dir/],
    ['work-dir', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', join(elsewhere, 'good'), '--model', MODEL, '--runner', 'tester', '--work-dir', '.', '--out', join(elsewhere, 'record.json')]), /--work-dir .* is deleted before the run, so it cannot be your home directory/],
    ['trial-lookup', () => f.run(['test', 'local-build', '--trial', 'no-such-trial', '--unpublished', './good', ...base]), /the published trial no-such-trial could not be read from .* \(\/trials\/no-such-trial\.json returned 404\); nothing was run/],
    ['shared-name', () => run('local-build', './shared'), /a case in .*shared has the name of a case of the published trial sample-trial \(case-name\)/],
    ['build-lookup', () => run('no-such-build', './good'), /the published build no-such-build could not be read from .* \(\/builds\/no-such-build\.json returned 404\)/],
    ['build-lookup', () => run('unreadable-build', './good'), /the published build unreadable-build could not be read/],
    ['build-archive', () => run('no-archive-build', './good'), /no-archive-build has no archive with a SHA-256 to run; nothing was run/],
    ['claude', () => run('local-build', './good', [], { PATH: join(f.root, 'bin-no-claude') }), /claude is not installed/],
  ];
  // Every row is checked, and every failing row is listed with what went wrong, so one run shows them all. Each row starts
  // from the same folders: a run that wrote through a link (as a version of this mode without the output checks did) cannot
  // spoil the rows after it.
  const pristine = mkdtempSync(join(tmpdir(), 'bg-unpublished-pristine-'));
  t.after(() => rmSync(pristine, { recursive: true, force: true }));
  cpSync(join(f.root, 'good'), pristine, { recursive: true });
  const failures = [];
  for (const [why, go, message] of ROWS) {
    const before = snapshot(f.root);
    const requests = f.requests.length;
    const r = await go();
    const after = snapshot(f.root);
    // The output-link row made its link before the run; that is the only difference allowed, and it is not the run's.
    if (why === 'output-link' && after['evidence-unpublished.json'] && !before['evidence-unpublished.json']) after['evidence-unpublished.json'] = before['evidence-unpublished.json'];
    const wrong = [
      r.status !== 1 && `exit ${r.status}`,
      !message.test(r.stderr) && `said "${r.stderr.trim().split('\n').filter(l => l.startsWith('buildguild:')).pop() || r.stderr.trim().split('\n').pop()}"`,
      existsSync(marker) && 'a fixture ran',
      f.requests.slice(requests).some(u => u.endsWith('.zip')) && 'an archive was fetched',
      !isDeepStrictEqual(Object.fromEntries(Object.entries(after).filter(([, v]) => v !== undefined)), before) && 'a file was written, changed or deleted',
    ].filter(Boolean);
    if (wrong.length) failures.push(`${why} (${message.source.slice(0, 50)}): ${wrong.join('; ')}`);
    // Put things back for the next row.
    rmSync(marker, { force: true });
    rmSync(join(f.root, 'evidence-unpublished.json'), { force: true });
    if (!existsSync(join(f.root, 'work/keep.txt'))) f.write('work/keep.txt', 'kept');
    rmSync(join(f.root, 'good'), { recursive: true, force: true });
    cpSync(pristine, join(f.root, 'good'), { recursive: true });
  }
  assert.deepEqual(failures, []);
  // Every named refusal in the CLI has at least one row.
  const source = readFileSync(cli, 'utf8');
  const named = new Set([...source.matchAll(/refuse\('([a-z-]+)'/g), ...source.matchAll(/lookUp\([^,]+, '([a-z-]+)'/g)].map(m => m[1]));
  assert.deepEqual([...named].filter(why => !ROWS.some(([w]) => w === why)), [], 'a named refusal has no row in this table');
  assert.deepEqual(ROWS.map(([w]) => w).filter(why => !named.has(why)), [], 'a row names a refusal the CLI does not have');
  assert.equal(readFileSync(join(f.root, 'work/keep.txt'), 'utf8'), 'kept');
  assert.equal(readFileSync(join(f.root, 'good/cases', PRIVATE[1].name, 'prompt.md'), 'utf8'), `---\ntags: [${PRIVATE[1].dimension}]\nallowed_tools: [Write]\n---\n${PRIVATE[1].prompt}\n`);
  assert.deepEqual(f.claudeCalls(), []);
  // The same folder with nothing to refuse runs its fixture, then its cases.
  const ok = await run('local-build', './good');
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(existsSync(marker));
});

// Review 6031210034, finding 2: the report must be this run's. An archive that ships one, and a runner that writes none, give
// no record; and only exit 0 is taken.
test('a report the archive shipped is removed before the run, and only a report this run wrote, with exit 0, gives a record', async t => {
  const f = await setup(t);
  const good = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-good.json']);
  assert.equal(good.status, 0, good.stderr);
  // A build whose archive carries that complete report where the runner writes its own.
  const staleZip = zipOf({ ...Object.fromEntries(Object.entries(BUILD_FILES).map(([k, v]) => [k.replace(/^local-build/, 'stale-build'), v])), 'stale-build/buildguild-raw.json': readFileSync(join(f.root, 'raw-good.json')) });
  f.routes['/builds/stale-build.json'] = build => JSON.stringify(build('stale-build', staleZip));
  f.routes['/dl/stale-build.zip'] = staleZip;
  rmSync(join(f.root, 'evidence-unpublished.json'));
  const stale = await f.run(['test', 'stale-build', '--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--model', MODEL, '--runner', 'tester', '--work-dir', './work'], { STUB_DAMAGE: 'no-report' });
  assert.equal(stale.status, 2, stale.stderr);
  assert.match(stale.stderr, /the runner wrote no report \(exit 90\), so no record was written/);
  assert.ok(!existsSync(join(f.root, 'evidence-unpublished.json')));
  assert.ok(!existsSync(join(f.root, 'work/buildguild-raw.json')), 'the shipped report was removed before the run');
  // A complete report with exit 2 (the cost ceiling) is still refused.
  const two = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-exit-2.json'], { STUB_DAMAGE: 'exit-2' });
  assert.equal(two.status, 2);
  assert.match(two.stderr, /\n  - the runner exited 2 \(the cost ceiling stopped it\), not 0\n/);
  assert.ok(!existsSync(join(f.root, 'evidence-unpublished.json')));
  assert.equal(f.json('raw-exit-2.json').trialSource, 'unpublished');
});

// Finding 3, the other side: a grader the runner marks with-only is not part of the score under with-without, and may go
// unscored in the bare arm.
test('a with-only grader left unscored in the bare arm does not make a run incomplete', async t => {
  const f = await setup(t);
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7'], { STUB_DAMAGE: 'with-only' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.json('evidence-unpublished.json').hiddenSlice, true);
});

// Finding 6: names whose byte order and locale order differ; swapping in localeCompare fails both assertions.
test('the cases are numbered, and the checksum ordered, by the bytes of the names, not by locale', async t => {
  const f = await setup(t);
  f.writeFolder('mixed', MIXED);
  assert.ok('a-lower-ledger'.localeCompare('B-upper-switch') < 0, 'the locale here puts a before B');
  const sum = await f.run(['unpublished', './mixed']);
  assert.equal(sum.status, 0, sum.stderr);
  assert.equal(digestOf(sum.stdout).sha256, shellChecksum(join(f.root, 'mixed')), 'the LC_ALL=C recipe and the CLI agree');
  assert.equal(digestOf(sum.stdout).sha256, '706dff047c21677f4e609fa550e6e8a7589185371c4ed0287f9cdde7f1b2d2cb');
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './mixed']);
  assert.equal(r.status, 0, r.stderr);
  // Byte order: B-upper-switch, a-lower-ledger, c-lower-gauge.
  assert.deepEqual(f.json('evidence-unpublished.json').results.cases, [
    { name: 'unpublished-1', score: 0.75, delta: 0.5 },
    { name: 'unpublished-2', score: 1, delta: 0.5 },
    { name: 'unpublished-3', score: 0.5, delta: 0 },
  ]);
});

// The same kind of gap, looked for again: wrap writes nothing the run did not record.
test('wrap takes every fact from the run\'s report and refuses a flag that says otherwise', async t => {
  const f = await setup(t);
  const r = await f.testRun(['--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--raw-out', 'raw-private.json', '--rep', '2']);
  assert.equal(r.status, 0, r.stderr);
  const fromTest = f.json('evidence-unpublished-rep2.json');
  // No --build or --runner: both come from the report, and so do the date, the --rep suffix and the environment.
  const bare = await f.run(wrapOf('raw-private.json'));
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(withoutId(JSON.parse(bare.stdout)), withoutId(fromTest));
  assert.match(JSON.parse(bare.stdout).id, /^\d{4}-\d{2}-\d{2}-tester-[a-z0-9]{1,6}-rep2$/);
  for (const [extra, message] of [
    [['--model', 'claude-opus-5-5'], /--model claude-opus-5-5 is not the run's claude-sonnet-5-5/],
    [['--build', 'another-build'], /--build another-build is not the run's local-build/],
    [['--build-version', '9.9.9'], /--build-version 9\.9\.9 is not the run's 0\.1\.0/],
    [['--runner', 'someone-else'], /--runner someone-else is not the run's tester/],
    [['--sha256', 'a'.repeat(64)], new RegExp(`--sha256 a{64} is not the run's ${BUILD_SHA}`)],
  ]) {
    const args = wrapOf('raw-private.json', extra);
    if (extra[0] === '--model') args.splice(args.indexOf('--model'), 2);
    const w = await f.run(args);
    assert.equal(w.status, 1, extra.join(' '));
    assert.match(w.stderr, message);
    assert.equal(w.stdout, '');
  }
  // The record's date is the run's, from the marker, whatever day wrap runs on.
  const raw = f.json('raw-private.json');
  writeFileSync(join(f.root, 'raw-dated.json'), JSON.stringify({ ...raw, unpublishedRun: { ...raw.unpublishedRun, date: '2026-01-02' } }));
  const dated = JSON.parse((await f.run(wrapOf('raw-dated.json'))).stdout);
  assert.equal(dated.date, '2026-01-02');
  assert.match(dated.id, /^2026-01-02-tester-/);
  // A marker without the run's facts, as an earlier version of this mode wrote it, is refused.
  const { trial, trialVersion, count, sha256 } = raw.unpublishedRun;
  writeFileSync(join(f.root, 'raw-old-marker.json'), JSON.stringify({ ...raw, unpublishedRun: { trial, trialVersion, count, sha256, modules: [] } }));
  const old = await f.run(wrapOf('raw-old-marker.json'));
  assert.equal(old.status, 1);
  assert.match(old.stderr, /raw-old-marker\.json is not the report of a run with --unpublished, so it cannot become a hidden-slice record/);
});
