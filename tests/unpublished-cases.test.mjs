// `test --unpublished`: a private folder of cases run as the unpublished part (hidden slice) of a published trial, `wrap`
// rebuilding its record, the `unpublished` command's count and checksum, and `submit` refusing such a record. Nothing here
// calls a model or the network: the CLI runs against a stub claude and a server on 127.0.0.1.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
// The runner grades a run that ended in an ordinary error, such as running out of turns (Claude Code 2.1.321).
if (damage.includes('max-turns')) cases[0].arms.with[0].error = 'exit 1: Reached maximum number of turns (2)';
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
  // An ordinary run.
  const testRun = (args, extraEnv) => run(['test', 'local-build', '--model', MODEL, '--runner', 'tester', '--work-dir', './work', ...args], extraEnv);
  // A run on unpublished cases: each call creates its own run folder, raw report and record, as the mode requires new paths.
  let calls = 0;
  const hidden = async (extra = [], extraEnv, { folder = './private-folder-q7' } = {}) => {
    const n = ++calls, paths = { work: `run-${n}`, raw: `raw-${n}.json`, out: `evidence-${n}.json` };
    const r = await run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', folder, '--model', MODEL, '--runner', 'tester', '--work-dir', paths.work, '--raw-out', paths.raw, '--out', paths.out, ...extra], extraEnv);
    return { ...r, ...paths };
  };
  const json = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
  const claudeCalls = () => existsSync(join(root, 'claude.log')) ? readFileSync(join(root, 'claude.log'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, write, writeFolder, run, testRun, hidden, json, claudeCalls, requests, routes };
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
const withoutId = record => JSON.stringify({ ...record, id: record.id.replace(/-[a-z0-9]{1,6}(-rep\d+)?$/, '$1') });
const wrapOf = (raw, out, extra = [], folder = './private-folder-q7') => ['wrap', raw, '--model', MODEL, '--trial', 'sample-trial', '--unpublished', folder, '--out', out, ...extra];

test('only the folder\'s cases run, with the runner arguments of any other run, and the record names them only by number', async t => {
  const f = await setup(t);
  const normal = await f.testRun(['--trial', 'sample-trial']);
  assert.equal(normal.status, 0, normal.stderr + normal.stdout);
  const r = await f.hidden(['--max-cost-usd', '2', '-j', '2']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const [first, second] = f.claudeCalls();
  assert.deepEqual(first.cases, ['case-name']);
  assert.deepEqual(second.cases, PRIVATE.map(c => c.name).sort(), 'the published case does not run, every folder case does');
  const sameButFlags = second.args.join(' ').replace('--max-cost-usd 2', '--max-cost-usd 5').replace(' -j 2', '');
  assert.equal(sameButFlags, first.args.join(' '), 'the runner gets the arguments of any other run');
  assert.ok(existsSync(join(f.root, 'fixture-ran')), 'test runs every check, fixtures included, as for a local trial folder');

  const record = f.json(r.out);
  const digest = digestOf((await f.run(['unpublished', './private-folder-q7'])).stdout);
  assert.deepEqual(Object.keys(record), ['schema', 'id', 'build', 'buildVersion', 'archiveSha256', 'trial', 'trialVersion', 'hiddenSlice', 'date', 'runner', 'role', 'gist', 'environment', 'results', 'unpublishedCases', 'cost', 'durationSeconds']);
  assert.equal(record.trial, 'sample-trial');
  assert.equal(record.trialVersion, '1.0.1', 'the published record\'s current version, not the folder\'s');
  assert.equal(record.hiddenSlice, true);
  assert.equal(record.role, 'guild');
  assert.equal(record.gist, null);
  assert.ok(!('trialSource' in record));
  assert.equal(record.buildVersion, '0.1.0');
  assert.equal(record.archiveSha256, BUILD_SHA);
  assert.deepEqual(record.unpublishedCases, { count: 3, sha256: digest.sha256 });
  // alpha 1, middle 2, zeta 3, whatever order they ran in; scores and gaps kept.
  assert.deepEqual(record.results.cases, [
    { name: 'unpublished-1', score: 1, delta: 0.5 },
    { name: 'unpublished-2', score: 0.5, delta: 0 },
    { name: 'unpublished-3', score: 0.75, delta: 0.5 },
  ]);
  assert.equal(record.results.overallScore, 0.75);
  assert.equal(record.results.casesTotal, 3);
  assert.equal(record.results.bareOverallScore, (0.5 + 0.5 + 0.25) / 3, 'the mean of each case\'s scoreWithout');
  assert.deepEqual(record.results.dimensions, { safety: 0.875, handoff: 0.5, cost: 0.85 });
  // Nothing private: no case name, prompt, folder name or path.
  const text = readFileSync(join(f.root, r.out), 'utf8');
  for (const secret of [...PRIVATE.flatMap(c => [c.name, c.prompt]), 'private-folder-q7', 'private-slice', f.root, 'fixture.sh']) assert.ok(!text.includes(secret), `the record holds ${secret}`);
  assert.deepEqual(text.match(/unpublished-\d+/g), ['unpublished-1', 'unpublished-2', 'unpublished-3']);
  // One warning names the private outputs; the raw report is marked with the run's facts, its exit status among them.
  const warnings = r.stderr.split('\n').filter(l => l.startsWith('warning:'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^warning: private files\. The run folder .*run-\d+, its raw report .*buildguild-raw\.json, the copy .*raw-\d+\.json hold the unpublished cases' names and prompts\. Do not commit, upload or paste them anywhere\./);
  const raw = f.json(r.raw);
  assert.equal(raw.trialSource, 'unpublished');
  assert.deepEqual(raw.unpublishedRun, { trial: 'sample-trial', trialVersion: '1.0.1', count: 3, sha256: digest.sha256,
    cases: PRIVATE.map(c => ({ name: c.name, dimension: c.dimension, graders: ['done'] })), build: 'local-build', buildVersion: '0.1.0', archiveSha256: BUILD_SHA, runner: 'tester',
    date: record.date, idSuffix: '', environment: record.environment, runnerExit: 0 });
  assert.deepEqual(f.json(`${r.work}/buildguild-raw.json`), raw);
  assert.match(r.stdout, /hidden-slice record: .*evidence-\d+\.json\n  overall 75%, \+33 pts over bare, 1\/3 cases, est\. \$0\.3; bare runtime 42%\nIt names the cases only as unpublished-1 to unpublished-3\./);
});

test('--role guild is accepted, and --rep names the default record', async t => {
  const f = await setup(t);
  const r = await f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--model', MODEL, '--runner', 'tester', '--role', 'guild', '--rep', '2', '--work-dir', 'run-a', '--raw-out', 'raw-a.json']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(f.json('evidence-unpublished-rep2.json').id, /-rep2$/);
});

test('the checksum ignores the folder\'s path, file times, file modes and creation order, and follows every byte and name', async t => {
  const f = await setup(t);
  const sumOf = async dir => { const r = await f.run(['unpublished', dir]); assert.equal(r.status, 0, r.stderr); return digestOf(r.stdout); };
  const base = await sumOf('./private-folder-q7');
  assert.equal(base.count, 3);
  assert.ok(!existsSync(join(f.root, 'fixture-ran')), 'the unpublished command runs no fixture');
  assert.deepEqual(f.claudeCalls(), []);
  assert.equal(base.sha256, shellChecksum(join(f.root, 'private-folder-q7')), 'the by-hand recipe gives the same checksum');
  const elsewhere = mkdtempSync(join(tmpdir(), 'bg-unpublished-copy-'));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  cpSync(join(f.root, 'private-folder-q7'), join(elsewhere, 'renamed'), { recursive: true });
  utimesSync(join(elsewhere, 'renamed/cases/alpha-secret-ledger/prompt.md'), new Date('2001-01-01'), new Date('2001-01-01'));
  chmodSync(join(elsewhere, 'renamed/cases/zeta-secret-rollout/fixture.sh'), 0o600);
  chmodSync(join(elsewhere, 'renamed/cases/alpha-secret-ledger/prompt.md'), 0o755);
  assert.deepEqual(await sumOf(join(elsewhere, 'renamed')), base);
  f.writeFolder('reversed', [...PRIVATE].reverse());
  f.write('reversed/cases/zeta-secret-rollout/fixture.sh', `echo ran >> ${JSON.stringify(join(f.root, 'fixture-ran'))}\n`, 0o755);
  f.write('reversed/cases/zeta-secret-rollout/case.yaml', 'schema_version: "1.1"\nname: zeta-secret-rollout\ncontext:\n  scaffold_script: fixture.sh\n');
  assert.deepEqual(await sumOf('./reversed'), base);
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
  f.writeFolder('fixed', PRIVATE);
  f.write('fixed/cases/middle-secret-handoff/setup.sh', 'true\n', 0o644);
  const r = await f.run(['unpublished', './fixed']);
  assert.equal(r.status, 0, r.stderr);
  const FIXED = '9690185489a9997719ce2a6d208062a056363c1da5ba8b87e57155e1321c75c9';
  assert.deepEqual(digestOf(r.stdout), { count: 3, sha256: FIXED });
  assert.equal(shellChecksum(join(f.root, 'fixed')), FIXED);
  assert.equal(r.stdout, `3 unpublished cases\nsha256 ${FIXED}\nunpublishedCases {"count":3,"sha256":"${FIXED}"}\n`);
});

test('the public trial\'s own cases are in the form this mode takes', async t => {
  // The form checks over the Client Deployment Trial's eight cases, through `unpublished` on a copy: no fixture or model runs,
  // and no published trial is involved, so the shared-name refusal does not apply.
  const trialDir = fileURLToPath(new URL('../content/trials/client-deployment-v1/', import.meta.url));
  const trialRecord = JSON.parse(readFileSync(fileURLToPath(new URL('../content/trials/client-deployment-v1.json', import.meta.url)), 'utf8'));
  const copy = mkdtempSync(join(tmpdir(), 'bg-unpublished-public-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(join(trialDir, 'cases'), join(copy, 'cases'), { recursive: true });
  writeFileSync(join(copy, 'trial.json'), JSON.stringify(trialRecord));
  writeFileSync(join(copy, 'README.md'), `${trialRecord.summary} ${trialRecord.notes}`);
  writeFileSync(join(copy, 'LICENSE'), 'Apache-2.0');
  const r = spawnSync(process.execPath, [cli, 'unpublished', copy], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^8 unpublished cases\n/);
});

test('wrap --unpublished writes the same record as test into a new --out, and refuses it any other way', async t => {
  const f = await setup(t);
  const r = await f.hidden();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const w = await f.run(wrapOf(r.raw, 'wrapped.json', ['--build', 'local-build', '--runner', 'tester']));
  assert.equal(w.status, 0, w.stderr);
  assert.equal(w.stdout, `hidden-slice record: ${join(realpathSync(f.root), 'wrapped.json')}\n`);
  assert.equal(withoutId(f.json('wrapped.json')), withoutId(f.json(r.out)));
  assert.notEqual(f.json('wrapped.json').id, f.json(r.out).id);
  const refusals = [
    [['wrap', r.raw, '--model', MODEL, '--build', 'local-build', '--trial', 'sample-trial'], /is the report of a run on unpublished cases; wrap it with --unpublished <the same folder> --trial <the published slug>/],
    [['wrap', r.raw, '--model', MODEL, '--trial', 'sample-trial', '--unpublished', './private-folder-q7'], /wrap --unpublished needs --out <new-file> for the record; nothing was written/],
    [wrapOf(r.raw, 'wrapped.json'), /--out .*wrapped\.json already exists; this mode creates its outputs and overwrites nothing/],
    [wrapOf(r.raw, 'w2.json', ['--role', 'author']), /--role must be guild or left out/],
    [wrapOf(r.raw, 'w2.json', ['--runs', '2']), /--runs is not accepted by wrap --unpublished/],
    [['wrap', r.raw, '--model', MODEL, '--trial', 'other-trial', '--unpublished', './private-folder-q7', '--out', 'w2.json'], /is a run on unpublished cases of sample-trial, not of other-trial/],
  ];
  for (const [args, message] of refusals) {
    const x = await f.run(args);
    assert.equal(x.status, 1, args.join(' '));
    assert.match(x.stderr, message, args.join(' '));
  }
  assert.ok(!existsSync(join(f.root, 'w2.json')));
  writeFileSync(join(f.root, 'raw-plain.json'), JSON.stringify({ ...f.json(r.raw), trialSource: undefined, unpublishedRun: undefined }));
  const plain = await f.run(wrapOf('raw-plain.json', 'w3.json'));
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /raw-plain\.json is not the report of a run with --unpublished/);
  f.write('private-folder-q7/cases/alpha-secret-ledger/prompt.md', '---\ntags: [safety]\nallowed_tools: [Write]\n---\nBalance the ledger twice.\n');
  const changed = await f.run(wrapOf(r.raw, 'w4.json'));
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /private-folder-q7 no longer holds the cases that run used/);
});

test('submit refuses a hidden-slice record before it looks for gh', async t => {
  const f = await setup(t);
  const r = await f.hidden();
  assert.equal(r.status, 0, r.stderr);
  writeFileSync(join(f.root, 'count-only.json'), JSON.stringify({ ...f.json(r.out), hiddenSlice: undefined }));
  for (const file of [r.out, 'count-only.json']) {
    const s = await f.run(['submit', file, '--yes']);
    assert.equal(s.status, 1, file);
    assert.equal(s.stderr, `buildguild: ${file} is a run on a trial's unpublished cases (a hidden-slice record). A maintainer adds it to Build by pull request; it is never sent as a Gist. Nothing was sent.\n`);
  }
});

test('the help text and the README name the mode, the flags it accepts and the checksum command', () => {
  const r = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /test <published-build> --trial <published-slug> --unpublished <trial-folder> --model <id> --runner <login>\n +--raw-out <new-file> --work-dir <new-folder> \[--out <new-file>\] \[--role guild\] \[--max-cost-usd 5\] \[-j n\] \[--rep k\] \[--keep-temp\]/);
  assert.match(r.stdout, /node cli\/buildguild\.mjs unpublished <trial-folder>/);
  assert.match(r.stdout, /refuses a local run and a hidden-slice record/);
  assert.match(readFileSync(fileURLToPath(new URL('../cli/README.md', import.meta.url)), 'utf8'), /## Run unpublished cases as a hidden slice/);
});

test('the unpublished command refuses a folder that is not one of cases, and any flag', async t => {
  const f = await setup(t);
  f.writeFolder('empty-folder', []);
  for (const [args, message] of [
    [['unpublished'], /usage: buildguild unpublished <trial-folder>/],
    [['unpublished', './missing'], /no trial folder at .*missing; nothing was run/],
    [['unpublished', './build'], /build has no trial\.json, so it is not a trial folder; nothing was run/],
    [['unpublished', './empty-folder'], /has no case/],
    [['unpublished', './private-folder-q7', '--no-fixtures'], /--no-fixtures is not accepted by unpublished/],
  ]) {
    const r = await f.run(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, message);
  }
  assert.deepEqual(f.claudeCalls(), []);
});

// Cases sort as alpha (unpublished-1), middle (2), zeta (3); the stub damages the first, alpha.
const DAMAGES = [
  ['partial', 'the run is partial: it stopped before every case had run'],
  ['arm-error', 'unpublished-1: a run of the bare runtime was not graded (a grader went unscored or missing, its score is not from 0 to 1, or paid graders were skipped)'],
  ['no-score', 'unpublished-1: a run with the build was not graded (a grader went unscored or missing, its score is not from 0 to 1, or paid graders were skipped)'],
  ['extra-run', 'unpublished-1: 2 runs of the bare runtime, where the case declares 1'],
  ['short-runs', 'unpublished-1: 1 runs with the build, where the case declares 2'],
  ['duplicate', 'the report holds more than one result for unpublished-1'],
  ['drop', 'the report holds no result for unpublished-1'],
  ['bad-total', 'the report counts 4 cases and lists 3, and the folder has 3'],
  ['bad-overall', 'the overall score 0.875 is not the mean of the case scores'],
  ['bad-delta', 'unpublished-1: its gap 0.625 is not its score minus its bare score'],
  ['other-model', 'the runner ran claude-haiku-5-5, not claude-sonnet-5-5'],
  ['no-ablation', 'the run did not compare the build with the bare runtime (ablation "none")'],
  ['skipped-graders', 'unpublished-1: a run with the build was not graded (a grader went unscored or missing, its score is not from 0 to 1, or paid graders were skipped)'],
  ['aborted', 'unpublished-1: a run with the build was aborted'],
  ['unscored', 'unpublished-1: a run with the build was not graded (a grader went unscored or missing, its score is not from 0 to 1, or paid graders were skipped)'],
  ['all-error', 'unpublished-1: a run with the build was not graded (a grader went unscored or missing, its score is not from 0 to 1, or paid graders were skipped)'],
  ['exit-2', 'the runner exited 2 (a partial report: the cost ceiling, an interruption or a failed sign-in), not 0'],
];

test('test --unpublished writes no record for a run that is not complete, and keeps the raw report, marked', async t => {
  const f = await setup(t);
  for (const [damage, problem] of DAMAGES) {
    const r = await f.hidden([], { STUB_DAMAGE: damage });
    assert.equal(r.status, 2, `${damage}: ${r.stderr}`);
    assert.ok(r.stderr.includes('buildguild: no record was written: the run on the unpublished cases is not complete.\n'), `${damage}: ${r.stderr}`);
    assert.ok(r.stderr.includes(`\n  - ${problem}\n`), `${damage}: ${r.stderr}`);
    assert.match(r.stderr, /The raw report .*buildguild-raw\.json and its copy .*raw-\d+\.json are kept, marked, to work out what happened/);
    assert.ok(!existsSync(join(f.root, r.out)), `${damage}: no record`);
    assert.equal(f.json(r.raw).trialSource, 'unpublished');
  }
});

// Review 6031674797, finding 3: the runner grades a run that ran out of turns, and so does this mode: a record, with a note.
test('a run that ended in an ordinary error and was still graded gives a record through test and wrap, with a note', async t => {
  const f = await setup(t);
  const r = await f.hidden([], { STUB_DAMAGE: 'max-turns' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /note: 1 of 6 runs ended in an error and were still graded; the record counts them as measured, as any record does/);
  assert.equal(f.json(r.out).hiddenSlice, true);
  const w = await f.run(wrapOf(r.raw, 'wrapped.json'));
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stderr, /note: 1 of 6 runs ended in an error and were still graded/);
  assert.equal(withoutId(f.json('wrapped.json')), withoutId(f.json(r.out)));
});

test('an ordinary run with the same damage behaves as it always has', async t => {
  const f = await setup(t);
  const partial = await f.testRun(['--trial', 'sample-trial'], { STUB_DAMAGE: 'partial' });
  assert.equal(partial.status, 0, partial.stderr);
  assert.equal(f.json('evidence.json').results.partial, true);
  const errored = await f.testRun(['--trial', 'sample-trial', '--out', 'errored.json'], { STUB_DAMAGE: 'arm-error' });
  assert.equal(errored.status, 0, errored.stderr);
  assert.match(errored.stderr, /note: 1 of 2 agent runs ended in an error; first: synthetic runner error/);
});

// Review 6031674797, finding 4, with the earlier ones: wrap applies the same rules, the runner's exit status among them.
test('wrap --unpublished refuses a report that is not complete, by the same checks as test', async t => {
  const f = await setup(t);
  for (const [damage, problem] of DAMAGES) {
    const r = await f.hidden([], { STUB_DAMAGE: damage });
    const w = await f.run(wrapOf(r.raw, `wrapped-${damage}.json`));
    assert.equal(w.status, 1, `${damage}: ${w.stdout}`);
    assert.ok(w.stderr.startsWith(`buildguild: no record was written: ${r.raw} is not the report of a complete run on the unpublished cases.\n`), `${damage}: ${w.stderr}`);
    assert.ok(w.stderr.includes(`\n  - ${problem}`), `${damage}: ${w.stderr}`);
    assert.ok(!existsSync(join(f.root, `wrapped-${damage}.json`)));
  }
});

test('a case listed twice in trial.json is refused by unpublished, test and wrap alike', async t => {
  const f = await setup(t);
  const good = await f.hidden();
  assert.equal(good.status, 0, good.stderr);
  const trialJson = join(f.root, 'private-folder-q7/trial.json');
  const record = JSON.parse(readFileSync(trialJson, 'utf8'));
  writeFileSync(trialJson, JSON.stringify({ ...record, cases: [...record.cases, record.cases[1]] }));
  const message = /private-folder-q7\/trial\.json lists alpha-secret-ledger more than once; each case is listed once\. Nothing was run\./;
  for (const args of [['unpublished', './private-folder-q7'], wrapOf(good.raw, 'wrapped.json')]) {
    const r = await f.run(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, message);
  }
  const calls = f.claudeCalls().length;
  const run = await f.hidden();
  assert.equal(run.status, 1);
  assert.match(run.stderr, message);
  assert.equal(f.claudeCalls().length, calls, 'nothing ran');
});

test('wrap keeps the dimensions the cases had at the run, and says so when trial.json has changed', async t => {
  const f = await setup(t);
  const r = await f.hidden();
  assert.equal(r.status, 0, r.stderr);
  const trialJson = join(f.root, 'private-folder-q7/trial.json');
  const record = JSON.parse(readFileSync(trialJson, 'utf8'));
  writeFileSync(trialJson, JSON.stringify({ ...record, cases: record.cases.map(c => c.name === 'zeta-secret-rollout' ? { ...c, dimension: 'quality' } : c) }));
  const w = await f.run(wrapOf(r.raw, 'wrapped.json'));
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stderr, /note: .*private-folder-q7\/trial\.json now gives unpublished-3 the dimension quality; the record keeps safety, its dimension at the run\n/);
  assert.deepEqual(f.json('wrapped.json').results.dimensions, { safety: 0.875, handoff: 0.5, cost: 0.85 });
  assert.equal(withoutId(f.json('wrapped.json')), withoutId(f.json(r.out)));
});

// Every refusal of the preflight, one row each: the check helper applies every check to every row, with no way for a row to
// skip one, and the test counts the checks made, so a row that asserts nothing fails it. Every refusal the CLI names
// (refuse('<why>', …), or lookUp(…, '<why>', …)) must have a row.
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function snapshot(dir) {
  const files = {};
  const walk = rel => {
    for (const name of readdirSync(join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, r));
      if (st.isSymbolicLink()) files[r] = `link:${readlinkSync(join(dir, r))}`;
      else if (st.isDirectory()) { files[`${r}/`] = 'dir'; walk(r); }
      else files[r] = `${sha(join(dir, r))}:${st.nlink}`;
    }
  };
  walk('');
  return files;
}
test('every refusal of the preflight runs, creates, downloads and writes nothing, and every named refusal has a row', async t => {
  const f = await setup(t);
  const marker = join(f.root, 'refused-fixture-ran');
  const withFixture = (dir, cases) => {
    f.writeFolder(dir, cases);
    f.write(`${dir}/cases/${cases[0].name}/case.yaml`, `schema_version: "1.1"\nname: ${cases[0].name}\ncontext:\n  scaffold_script: fixture.sh\n`);
    f.write(`${dir}/cases/${cases[0].name}/fixture.sh`, `echo ran >> ${JSON.stringify(marker)}\n`, 0o755);
  };
  const A = PRIVATE[1], M = PRIVATE[2];
  // Folders, each with a fixture that would leave the marker if anything ran it.
  withFixture('good', [A, M]);
  withFixture('shared', [{ name: 'case-name', dimension: 'quality', prompt: 'Same name as a published case.' }, A]);
  withFixture('short-readme', [A]); f.write('short-readme/README.md', 'Too short.');
  withFixture('twice', [A, M]); f.write('twice/trial.json', JSON.stringify({ ...f.json('twice/trial.json'), cases: [A, M, M].map(c => ({ name: c.name, dimension: c.dimension, runs: 1 })) }));
  withFixture('unnamed', [A]); f.write('unnamed/trial.json', JSON.stringify({ ...f.json('unnamed/trial.json'), cases: [{ dimension: 'safety', runs: 1 }] }));
  withFixture('mismatch', [A]); f.write('mismatch/trial.json', JSON.stringify({ ...f.json('mismatch/trial.json'), cases: [A, M].map(c => ({ name: c.name, dimension: c.dimension, runs: 1 })) }));
  withFixture('bad-json', [A]); f.write('bad-json/trial.json', '{ not json');
  withFixture('line-break', [A]); f.write(`line-break/cases/${A.name}/notes\n.txt`, 'a name with a line break');
  withFixture('backslash', [A]); f.write(`backslash/cases/${A.name}/notes\\x.txt`, 'a name with a backslash');
  // The public form, and the reviewer's shapes outside it.
  const grader = (dir, file, front) => f.write(`${dir}/cases/${A.name}/graders/${file}`, `---\n${front}\n---\n`);
  withFixture('quoted-key', [A]); grader('quoted-key', 'done.md', "type: regex\npattern: 'done'\n\"name\": renamed");
  withFixture('inline-graders', [A]); f.write(`inline-graders/cases/${A.name}/case.yaml`, `schema_version: "1.1"\nname: ${A.name}\ngraders:\n  - name: extra\n    type: regex\n    pattern: done\ncontext:\n  scaffold_script: fixture.sh\n`);
  withFixture('case-renamed', [A]); f.write(`case-renamed/cases/${A.name}/case.yaml`, `schema_version: "1.1"\nname: logical-case\ncontext:\n  scaffold_script: fixture.sh\n`);
  withFixture('prompt-named', [A]); f.write(`prompt-named/cases/${A.name}/prompt.md`, `---\nname: logical-case\ntags: [${A.dimension}]\nallowed_tools: [Write]\n---\n${A.prompt}\n`);
  withFixture('grader-named', [A]); grader('grader-named', 'done.md', "type: regex\npattern: 'done'\nname: renamed");
  withFixture('grader-arm', [A]); grader('grader-arm', 'indicator.md', 'type: tool_used\ntool: Write\narm: with-only');
  withFixture('skill-grader', [A]); grader('skill-grader', 'indicator.md', 'type: tool_used\ntool: Skill');
  withFixture('mock-grader', [A]); grader('mock-grader', 'indicator.md', "type: regex\ntarget: mock_calls\npattern: 'done'");
  f.writeFolder('empty', []);
  mkdirSync(join(f.root, 'no-trial'));
  mkdirSync(join(f.root, 'out-dir'));
  f.write('work/keep.txt', 'kept');
  mkdirSync(join(f.root, 'bin-no-claude'));
  cpSync(join(f.root, 'bin/which'), join(f.root, 'bin-no-claude/which'));
  symlinkSync('/bin/bash', join(f.root, 'bin-no-claude/bash'));
  f.routes['/builds/unreadable-build.json'] = '{ not json';
  const base = ['--model', MODEL, '--runner', 'tester', '--work-dir', 'new-run', '--raw-out', 'new-raw.json'];
  const run = (build, folder, extra = [], env) => f.run(['test', ...(build ? [build] : []), '--trial', 'sample-trial', '--unpublished', folder, ...base, ...extra], env);
  const row = (why, go, message, prepare = () => {}) => ({ why, go, message, prepare });
  const ROWS = [
    row('flag', () => run('local-build', './good', ['--runs', '3']), /--runs is not accepted by test --unpublished: the number of runs is part of each case, which the checksum fixes\. It accepts --trial, --unpublished/),
    row('flag', () => run('local-build', './good', ['--no-fixtures']), /--no-fixtures is not accepted by test --unpublished: every unpublished folder gets the fixture check/),
    row('flag', () => run('local-build', './good', ['--out', 'a.json', '--out', 'b.json']), /--out is given twice; nothing was run/),
    row('flag-value', () => run('local-build', './good', ['--out', '--keep-temp']), /--out needs a value; nothing was run/),
    row('flag-value', () => run('local-build', './good', ['-j', '9']), /-j needs a whole number from 1 to 8, as the runner takes, not "9"/),
    row('flag-value', () => run('local-build', './good', ['--max-cost-usd', 'lots']), /--max-cost-usd needs a positive number of USD, not "lots"/),
    row('model', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--runner', 'tester', '--work-dir', 'new-run', '--raw-out', 'new-raw.json']), /test needs --model <id>/),
    row('rep', () => run('local-build', './good', ['--rep', '0']), /--rep needs a whole number of at least 1; nothing was run/),
    row('runner', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--work-dir', 'new-run', '--raw-out', 'new-raw.json']), /with --unpublished, --runner names the GitHub login the record credits/),
    row('runner', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'not_a_login', '--work-dir', 'new-run', '--raw-out', 'new-raw.json']), /not "not_a_login"/),
    row('output-missing', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'tester', '--work-dir', 'new-run']), /with --unpublished, --raw-out is required/),
    row('output-missing', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'tester', '--raw-out', 'new-raw.json']), /with --unpublished, --work-dir is required/),
    row('role', () => run('local-build', './good', ['--role', 'author']), /--role must be guild or left out \(got "author"\); nothing was run/),
    row('trial-missing', () => f.run(['test', 'local-build', '--unpublished', './good', ...base]), /--unpublished needs --trial <slug>/),
    row('trial-folder', () => f.run(['test', 'local-build', '--trial', './good', '--unpublished', './good', ...base]), /--trial \.\/good is a folder/),
    row('trial-slug', () => f.run(['test', 'local-build', '--trial', 'Not_A_Slug', '--unpublished', './good', ...base]), /--trial "Not_A_Slug" is not a kebab-case slug/),
    row('build-missing', () => run(null, './good'), /usage: buildguild test <published-build>/),
    row('build-folder', () => run('./build', './good'), /\.\/build is a path here; with --unpublished the build is a published build, named by its slug/),
    row('build-slug', () => run('INVALID', './good'), /build must be a kebab-case slug, got "INVALID"; nothing was run/),
    row('folder-absent', () => run('local-build', './missing'), /no trial folder at .*missing; nothing was run/),
    row('folder-no-trial', () => run('local-build', './no-trial'), /no-trial has no trial\.json, so it is not a trial folder/),
    row('folder-json', () => run('local-build', './bad-json'), /bad-json\/trial\.json is not valid JSON/),
    row('folder-no-case', () => run('local-build', './empty'), /empty has no case/),
    row('roster-name', () => run('local-build', './unnamed'), /unnamed\/trial\.json lists a case without a name/),
    row('roster-twice', () => run('local-build', './twice'), /twice\/trial\.json lists middle-secret-handoff more than once/),
    row('roster-mismatch', () => run('local-build', './mismatch'), /mismatch\/trial\.json lists 2 cases and cases\/ holds 1 folders/),
    row('structure', () => run('local-build', './short-readme'), /short-readme: 1 problem\(s\)\n  - README\.md needs at least forty words/),
    row('file-name', () => run('local-build', './line-break'), /line-break\/cases holds a name outside the allowed ones \(letters, digits, "\.", "_" and "-"\): "alpha-secret-ledger\/notes\\n\.txt"/),
    row('file-name', () => run('local-build', './backslash'), /backslash\/cases holds a name outside the allowed ones .*"alpha-secret-ledger\/notes\\\\x\.txt"/),
    row('form-yaml', () => run('local-build', './quoted-key'), /quoted-key\/cases\/alpha-secret-ledger\/graders\/done\.md's front matter is not written as plain "key: value" lines/),
    row('form-inline-graders', () => run('local-build', './inline-graders'), /case\.yaml lists graders; in this mode graders are files under graders\/ only/),
    row('form-case-name', () => run('local-build', './case-renamed'), /case\.yaml names the case "logical-case"; it must be its folder's name, alpha-secret-ledger/),
    row('form-prompt-name', () => run('local-build', './prompt-named'), /prompt\.md's front matter names the case; in this mode a case's name is its folder's/),
    row('form-grader-name', () => run('local-build', './grader-named'), /graders\/done\.md sets a grader name; in this mode a grader's name is its file's/),
    row('form-grader-arm', () => run('local-build', './grader-arm'), /graders\/indicator\.md sets an arm; in this mode every grader scores both arms/),
    row('form-with-only', () => run('local-build', './skill-grader'), /graders\/indicator\.md is a grader the runner treats as with-only/),
    row('form-with-only', () => run('local-build', './mock-grader'), /graders\/indicator\.md is a grader the runner treats as with-only/),
    row('output-exists', () => run('local-build', './good'), /--out .*evidence-unpublished\.json already exists; this mode creates its outputs and overwrites nothing/,
      () => linkSync(join(f.root, 'good/cases', A.name, 'prompt.md'), join(f.root, 'evidence-unpublished.json'))),
    row('output-exists', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'tester', '--work-dir', 'new-run', '--raw-out', 'raw-hard.json', '--out', 'record-new.json']), /--raw-out .*raw-hard\.json already exists/,
      () => { f.write('empty-evidence.json', ''); linkSync(join(f.root, 'empty-evidence.json'), join(f.root, 'raw-hard.json')); }),
    row('output-exists', () => run('local-build', './good', ['--out', 'out-dir']), /--out .*out-dir already exists/),
    row('output-exists', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'tester', '--work-dir', 'work', '--raw-out', 'new-raw.json']), /--work-dir .*work already exists/),
    row('output-parent', () => run('local-build', './good', ['--out', 'absent/evidence.json']), /--out .*absent\/evidence\.json is not in an existing folder/),
    row('output-parent', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'tester', '--work-dir', 'new-run', '--raw-out', 'absent/raw.json']), /--raw-out .*absent\/raw\.json is not in an existing folder/),
    row('output-in-folder', () => run('local-build', './good', ['--out', './good/record.json']), /--out .*good\/record\.json is inside the unpublished folder/),
    row('output-in-folder', () => f.run(['test', 'local-build', '--trial', 'sample-trial', '--unpublished', './good', '--model', MODEL, '--runner', 'tester', '--work-dir', './good/run', '--raw-out', 'new-raw.json']), /--work-dir .*good\/run is inside the unpublished folder/),
    row('output-same', () => run('local-build', './good', ['--out', 'new-raw.json']), /--out and --raw-out are the same path/),
    row('trial-lookup', () => f.run(['test', 'local-build', '--trial', 'no-such-trial', '--unpublished', './good', ...base]), /the published trial no-such-trial could not be read from .* \(\/trials\/no-such-trial\.json returned 404\); nothing was run/),
    row('shared-name', () => run('local-build', './shared'), /a case in .*shared has the name of a case of the published trial sample-trial \(case-name\)/),
    row('build-lookup', () => run('no-such-build', './good'), /the published build no-such-build could not be read from .* \(\/builds\/no-such-build\.json returned 404\)/),
    row('build-lookup', () => run('unreadable-build', './good'), /the published build unreadable-build could not be read/),
    row('build-archive', () => run('no-archive-build', './good'), /no-archive-build has no archive with a SHA-256 to run; nothing was run/),
    row('claude', () => run('local-build', './good', [], { PATH: join(f.root, 'bin-no-claude') }), /claude is not installed/),
  ];
  const CHECKS = [
    ['exits 1', c => c.r.status === 1],
    ['says why', c => c.row.message.test(c.r.stderr)],
    ['runs no fixture', () => !existsSync(marker)],
    ['fetches no archive', c => !c.requests.some(u => u.endsWith('.zip'))],
    ['creates, writes, changes and deletes no file', c => isDeepStrictEqual(c.after, c.before)],
  ];
  const failures = [];
  let made = 0;
  const check = context => { for (const [what, ok] of CHECKS) { made += 1; if (!ok(context)) failures.push(`${context.row.why} (${context.row.message.source.slice(0, 50)}): ${what}${what === 'says why' ? `; said "${context.r.stderr.trim().split('\n').pop()}"` : ''}`); } };
  const pristine = mkdtempSync(join(tmpdir(), 'bg-unpublished-pristine-'));
  t.after(() => rmSync(pristine, { recursive: true, force: true }));
  cpSync(join(f.root, 'good'), pristine, { recursive: true });
  for (const r of ROWS) {
    r.prepare();
    const before = snapshot(f.root), requests = f.requests.length;
    const result = await r.go();
    check({ row: r, r: result, before, after: snapshot(f.root), requests: f.requests.slice(requests) });
    // Put things back for the next row, so a row that wrote something cannot spoil the rows after it.
    for (const p of ['evidence-unpublished.json', 'raw-hard.json', 'empty-evidence.json', 'new-raw.json', 'record-new.json', 'new-run']) rmSync(join(f.root, p), { recursive: true, force: true });
    rmSync(marker, { force: true });
    rmSync(join(f.root, 'good'), { recursive: true, force: true });
    cpSync(pristine, join(f.root, 'good'), { recursive: true });
  }
  assert.deepEqual(failures, []);
  assert.equal(made, ROWS.length * CHECKS.length, 'every row went through every check');
  const source = readFileSync(cli, 'utf8');
  const named = new Set([...source.matchAll(/refuse\('([a-z-]+)'/g), ...source.matchAll(/lookUp\([^,]+, '([a-z-]+)'/g)].map(m => m[1]));
  assert.deepEqual([...named].filter(why => !ROWS.some(r => r.why === why)), [], 'a named refusal has no row in this table');
  assert.deepEqual(ROWS.map(r => r.why).filter(why => !named.has(why)), [], 'a row names a refusal the CLI does not have');
  assert.equal(readFileSync(join(f.root, 'work/keep.txt'), 'utf8'), 'kept');
  assert.deepEqual(f.claudeCalls(), []);
  // The same folder with nothing to refuse runs its fixture, then its cases.
  const ok = await run('local-build', './good');
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(existsSync(marker));
});

// A report the archive ships is never written into the run folder, and a runner that writes none gives no record.
test('the report read after the run is the one this run wrote', async t => {
  const f = await setup(t);
  const good = await f.hidden();
  assert.equal(good.status, 0, good.stderr);
  const staleZip = zipOf({ ...Object.fromEntries(Object.entries(BUILD_FILES).map(([k, v]) => [k.replace(/^local-build/, 'stale-build'), v])), 'stale-build/buildguild-raw.json': readFileSync(join(f.root, good.raw)), 'stale-build/evals/old-case/prompt.md': 'an evals/ the cases replace' });
  f.routes['/builds/stale-build.json'] = build => JSON.stringify(build('stale-build', staleZip));
  f.routes['/dl/stale-build.zip'] = staleZip;
  const stale = await f.run(['test', 'stale-build', '--trial', 'sample-trial', '--unpublished', './private-folder-q7', '--model', MODEL, '--runner', 'tester', '--work-dir', 'stale-run', '--raw-out', 'stale-raw.json', '--out', 'stale-record.json'], { STUB_DAMAGE: 'no-report' });
  assert.equal(stale.status, 2, stale.stderr);
  assert.match(stale.stderr, /the runner wrote no report \(exit 90\), so no record was written/);
  assert.ok(!existsSync(join(f.root, 'stale-record.json')));
  assert.ok(!existsSync(join(f.root, 'stale-run/buildguild-raw.json')), 'the shipped report was never written');
  assert.ok(!existsSync(join(f.root, 'stale-run/evals/old-case')), 'the shipped evals/ was never written');
});

test('the cases are numbered, and the checksum ordered, by the bytes of the names, not by locale', async t => {
  const f = await setup(t);
  f.writeFolder('mixed', MIXED);
  assert.ok('a-lower-ledger'.localeCompare('B-upper-switch') < 0, 'the locale here puts a before B');
  const sum = await f.run(['unpublished', './mixed']);
  assert.equal(sum.status, 0, sum.stderr);
  assert.equal(digestOf(sum.stdout).sha256, shellChecksum(join(f.root, 'mixed')), 'the LC_ALL=C recipe and the CLI agree');
  assert.equal(digestOf(sum.stdout).sha256, '706dff047c21677f4e609fa550e6e8a7589185371c4ed0287f9cdde7f1b2d2cb');
  const r = await f.hidden([], undefined, { folder: './mixed' });
  assert.equal(r.status, 0, r.stderr);
  // Byte order: B-upper-switch, a-lower-ledger, c-lower-gauge.
  assert.deepEqual(f.json(r.out).results.cases, [
    { name: 'unpublished-1', score: 0.75, delta: 0.5 },
    { name: 'unpublished-2', score: 1, delta: 0.5 },
    { name: 'unpublished-3', score: 0.5, delta: 0 },
  ]);
});

test('wrap takes every fact from the run\'s report and refuses a flag that says otherwise', async t => {
  const f = await setup(t);
  const r = await f.hidden(['--rep', '2']);
  assert.equal(r.status, 0, r.stderr);
  const plain = await f.run(wrapOf(r.raw, 'w-plain.json'));
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(withoutId(f.json('w-plain.json')), withoutId(f.json(r.out)));
  assert.match(f.json('w-plain.json').id, /^\d{4}-\d{2}-\d{2}-tester-[a-z0-9]{1,6}-rep2$/);
  for (const [extra, message] of [
    [['--model', 'claude-opus-5-5'], /--model claude-opus-5-5 is not the run's claude-sonnet-5-5/],
    [['--build', 'another-build'], /--build another-build is not the run's local-build/],
    [['--build-version', '9.9.9'], /--build-version 9\.9\.9 is not the run's 0\.1\.0/],
    [['--runner', 'someone-else'], /--runner someone-else is not the run's tester/],
    [['--sha256', 'a'.repeat(64)], new RegExp(`--sha256 a{64} is not the run's ${BUILD_SHA}`)],
  ]) {
    const args = wrapOf(r.raw, 'w-x.json', extra);
    if (extra[0] === '--model') args.splice(args.indexOf('--model'), 2);
    const w = await f.run(args);
    assert.equal(w.status, 1, extra.join(' '));
    assert.match(w.stderr, message);
    assert.ok(!existsSync(join(f.root, 'w-x.json')));
  }
  const raw = f.json(r.raw);
  writeFileSync(join(f.root, 'raw-dated.json'), JSON.stringify({ ...raw, unpublishedRun: { ...raw.unpublishedRun, date: '2026-01-02' } }));
  assert.equal((await f.run(wrapOf('raw-dated.json', 'w-dated.json'))).status, 0);
  assert.equal(f.json('w-dated.json').date, '2026-01-02');
  assert.match(f.json('w-dated.json').id, /^2026-01-02-tester-/);
  // A marker without every fact of the run, as earlier versions of this mode wrote it, is refused.
  const { runnerExit, ...noExit } = raw.unpublishedRun;
  writeFileSync(join(f.root, 'raw-old-marker.json'), JSON.stringify({ ...raw, unpublishedRun: noExit }));
  const old = await f.run(wrapOf('raw-old-marker.json', 'w-old.json'));
  assert.equal(old.status, 1);
  assert.match(old.stderr, /raw-old-marker\.json is not the report of a run with --unpublished, so it cannot become a hidden-slice record/);
});
