import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const sha = '0123456789abcdef0123456789abcdef01234567';
const refs = ['skill/github-skill', 'hook/site-hook', 'tool/unknown-tool'];
const expected = refs.map((ref, i) => ({ ref, sha: i === 0 ? sha : null }));
const index = { modules: [
  { type: 'skill', slug: 'github-skill', source: { kind: 'github', url: 'https://github.com/example/module' } },
  { type: 'hook', slug: 'site-hook', source: { kind: 'site', url: 'https://example.invalid/site' } },
] };
const readme = 'This synthetic trial exercises module commit recording without any model access or external network calls. It contains a local task and a deterministic grader, with enough documentation to pass the normal trial checks. All executables are controlled stubs and all output is disposable test data.';
const raw = { claudeVersion: '2.1.314', aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1 },
  cases: [{ name: 'case-name', aggregates: { score: 1 } }], costUsd: 0, durationSeconds: 1 };

async function setup(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bg-module-pins-'));
  const write = (relative, contents, mode = 0o600) => {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents), { mode });
  };
  const executable = (name, code) => write(`bin/${name}`, `#!${process.execPath}\n${code}`, 0o700);
  write('build/buildguild.json', { slug: 'local-build', modules: options.refs ?? refs });
  const trial = { schema: 'buildguild.trial.v1', slug: 'sample-trial', name: 'Sample trial', version: '1.0.0',
    kind: 'community', author: 'tester', license: 'Apache-2.0', summary: readme, categories: ['delivery'],
    cases: [{ name: 'case-name', dimension: 'quality', runs: 1 }], tolerance: { overall: 0.1 }, archive: 'https://buildguild.gg/trial.zip' };
  write('trial/trial.json', trial);
  write('trial/README.md', readme);
  write('trial/LICENSE', 'Apache-2.0');
  write('trial/cases/case-name/prompt.md', '---\ntags: [quality]\nallowed_tools: [Write]\n---\nWrite done.\n');
  write('trial/cases/case-name/graders/done.md', "---\ntype: regex\npattern: 'done'\n---\n");
  write('site/modules/index.json', options.index ?? index);
  write('site/trials/sample-trial.json', trial);
  // Stored ZIP containing cases/case-name/prompt.md with "Write done.\n".
  const zip = Buffer.from('UEsDBBQAAAAAAAAAIVzncEO0DAAAAAwAAAAZAAAAY2FzZXMvY2FzZS1uYW1lL3Byb21wdC5tZFdyaXRlIGRvbmUuClBLAQIUAxQAAAAAAAAAIVzncEO0DAAAAAwAAAAZAAAAAAAAAAAAAACAAQAAAABjYXNlcy9jYXNlLW5hbWUvcHJvbXB0Lm1kUEsFBgAAAAABAAEARwAAAEMAAAAAAA==', 'base64');
  write('site/trial.zip', zip);
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const files = ['/modules/index.json', '/trials/sample-trial.json', '/trial.zip'];
    if (req.method !== 'GET' || !files.includes(req.url)) { res.writeHead(404).end(); return; }
    res.writeHead(req.url === '/modules/index.json' ? (options.indexStatus ?? 200) : 200);
    res.end(readFileSync(join(root, 'site', req.url)));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  executable('which', `
    const { accessSync, constants } = require('node:fs');
    const path = require('node:path').join(process.env.PATH, process.argv[2]);
    try { accessSync(path, constants.X_OK); console.log(path); } catch { process.exit(1); }
  `);
  if (options.git !== false) executable('git', `
    const { appendFileSync } = require('node:fs');
    const args = process.argv.slice(2);
    if (args[0] !== 'ls-remote') process.exit(90);
    appendFileSync(${JSON.stringify(join(root, 'git.log'))}, JSON.stringify(args) + '\\n');
    ${options.gitCode ?? `console.log('${sha}\\tHEAD');`}
  `);
  const runner = () => executable('claude', `
    const { appendFileSync, writeFileSync } = require('node:fs');
    const args = process.argv.slice(2);
    if (args[0] === '--version') { console.log('2.1.314 (Claude Code)'); process.exit(0); }
    if (args[0] !== 'plugin' || args[1] !== 'eval') process.exit(90);
    appendFileSync(${JSON.stringify(join(root, 'claude.log'))}, JSON.stringify(args) + '\\n');
    writeFileSync(args[args.indexOf('--json') + 1], ${JSON.stringify(JSON.stringify(raw))});
  `);
  const env = { PATH: join(root, 'bin'), HOME: root, BUILDGUILD_ORIGIN: `http://127.0.0.1:${server.address().port}` };
  const invoke = (args, input) => new Promise(resolve => {
    const child = execFile(process.execPath, [cli, ...args], { cwd: root, env, timeout: 25000 }, (error, stdout, stderr) => {
      resolve({ status: error?.code ?? 0, stdout, stderr, error });
    });
    child.stdin.end(input);
  });
  return {
    root, requests, runner, executable, write, invoke,
    run: (published = false) => invoke(['test', './build', '--trial', published ? 'sample-trial' : './trial',
      '--model', 'claude-sonnet-5-5', '--runner', 'tester', '--work-dir', './work']),
    record: (published = false) => JSON.parse(readFileSync(join(root, published ? 'evidence.json' : 'local-run.json'), 'utf8')),
    gitCalls: () => existsSync(join(root, 'git.log')) ? readFileSync(join(root, 'git.log'), 'utf8').trim().split('\n').map(JSON.parse) : [],
  };
}

function expectPins(result, count, total = 3, status = 0) {
  assert.equal(result.status, status, result.stderr + result.stdout);
  assert.deepEqual(result.stdout.match(/^pinned .*$/gm), [`pinned ${count} of ${total} modules`]);
  assert.equal(result.stderr, status === 0 ? '' : 'buildguild: claude is not installed; install Claude Code 2.1.269 or later\n');
}

test('resolves modules before the missing-Claude check', async t => {
  const f = await setup(t);
  expectPins(await f.run(), 1, 3, 1);
  assert.deepEqual(f.gitCalls(), [['ls-remote', 'https://github.com/example/module', 'HEAD']]);
  assert.deepEqual(f.requests, ['GET /modules/index.json']);
});

for (const published of [false, true]) test(`writes ordered pins in ${published ? 'published evidence' : 'local records'}`, async t => {
  const f = await setup(t);
  f.runner();
  expectPins(await f.run(published), 1);
  const record = f.record(published);
  assert.deepEqual(record.environment.modules, expected);
  assert.equal(Object.keys(record.environment).at(-1), 'modules');
  assert.deepEqual(Object.keys(record.environment), ['os', 'claudeCode', 'model', 'effort', 'node', 'modules']);
  assert.equal(record.trialSource, published ? undefined : 'local');
  assert.equal(f.gitCalls().length, 1);
});

test('missing git produces nulls and still reaches the Claude check and record writer', async t => {
  const f = await setup(t, { git: false });
  expectPins(await f.run(), 0, 3, 1);
  f.runner();
  expectPins(await f.run(), 0);
  assert.deepEqual(f.record().environment.modules, refs.map(ref => ({ ref, sha: null })));
});

for (const suffix of ['/tree/release', '/tree/release/skills/example']) test(`resolves a branch URL ending in ${suffix}`, async t => {
  const sourceIndex = structuredClone(index);
  sourceIndex.modules[0].source.url += suffix;
  const f = await setup(t, { index: sourceIndex });
  expectPins(await f.run(), 1, 3, 1);
  assert.deepEqual(f.gitCalls(), [['ls-remote', 'https://github.com/example/module', 'refs/heads/release']]);
});

for (const [name, gitCode] of [
  ['non-zero exit', `console.log('${sha}\\tHEAD'); console.error('synthetic git error'); process.exit(1);`],
  ['timeout', `console.log('${sha}\\tHEAD'); setTimeout(() => {}, 60000);`],
  ['uppercase SHA', `console.log('${sha.toUpperCase()}\\tHEAD');`],
  ['short SHA', "console.log('abc123\\tHEAD');"],
  ['empty output', ''],
]) test(`${name} leaves a null pin without failing the run`, async t => {
  const f = await setup(t, { gitCode });
  f.runner();
  const started = Date.now();
  expectPins(await f.run(), 0);
  if (name === 'timeout') assert.ok(Date.now() - started >= 14000, 'git must receive the 15-second timeout');
  assert.deepEqual(f.record().environment.modules, refs.map(ref => ({ ref, sha: null })));
});

for (const [name, options] of [
  ['HTTP failure', { indexStatus: 503 }],
  ['invalid JSON', { index: 'not json' }],
  ['invalid index shape', { index: {} }],
]) test(`${name} records nulls and emits only the pin summary`, async t => {
  const f = await setup(t, options);
  expectPins(await f.run(), 0, 3, 1);
  f.runner();
  expectPins(await f.run(), 0);
  assert.deepEqual(f.record().environment.modules, refs.map(ref => ({ ref, sha: null })));
  assert.deepEqual(f.gitCalls(), []);
});

test('archive sources remain null and do not invoke git', async t => {
  const sourceIndex = structuredClone(index);
  sourceIndex.modules[0].source.kind = 'archive';
  const f = await setup(t, { index: sourceIndex });
  f.runner();
  expectPins(await f.run(), 0);
  assert.deepEqual(f.record().environment.modules, refs.map(ref => ({ ref, sha: null })));
  assert.deepEqual(f.gitCalls(), []);
});

test('only emits valid refs and no more than 60 entries from an unchecked local build', async t => {
  const valid = Array.from({ length: 61 }, (_, i) => `skill/module-${i}`);
  const f = await setup(t, { refs: [null, 5, {}, 'invalid/slug', 'skill/Bad', 'skill/too/many', ...valid] });
  f.runner();
  expectPins(await f.run(), 0, 67);
  assert.deepEqual(f.record().environment.modules, valid.slice(0, 60).map(ref => ({ ref, sha: null })));
});

test('an empty build records an empty module array', async t => {
  const f = await setup(t, { refs: [] });
  f.runner();
  expectPins(await f.run(), 0, 0);
  assert.deepEqual(f.record().environment.modules, []);
});

for (const published of [false, true]) test(`standalone wrap includes empty pins for a ${published ? 'published' : 'local'} trial`, async t => {
  const f = await setup(t);
  f.write('raw.json', raw);
  const result = await f.invoke(['wrap', './raw.json', '--build', 'local-build', '--trial', published ? 'sample-trial' : './trial', '--model', 'claude-sonnet-5-5']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).environment.modules, []);
  assert.ok(!f.requests.includes('GET /modules/index.json'));
});

test('submit prints the module pins in its summary before cancellation, without publishing', async t => {
  const f = await setup(t);
  f.runner();
  expectPins(await f.run(true), 1);
  f.executable('gh', `
    const args = process.argv.slice(2);
    if (JSON.stringify(args) !== JSON.stringify(['api', 'user', '--jq', '.login'])) process.exit(90);
    console.log('synthetic-tester');
  `);
  const result = await f.invoke(['submit', './evidence.json'], 'n\n');
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.indexOf('\nProceed?')));
  assert.deepEqual(summary.environment.modules, expected);
  assert.match(result.stderr, /cancelled/);
  assert.ok(f.requests.every(request => request.startsWith('GET ')));
});
