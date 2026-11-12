// Repeated hosted runs: the Season trial workflow's plan (.github/scripts/plan-trial-runs.mjs) and `buildguild test --rep`.
// Nothing here calls a model or the network: the plan is called directly or with only verify-only requests, and the CLI
// runs against a stub claude and a server on 127.0.0.1.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { artifactName, KEY_CHECK_BUDGET_USD, planRuns, PlanError, trialBudget } from '../.github/scripts/plan-trial-runs.mjs';

const script = fileURLToPath(new URL('../.github/scripts/plan-trial-runs.mjs', import.meta.url));
const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/trial.yml', import.meta.url)), 'utf8');
const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const builds = new Set(['measured-delivery', 'lean-start']);
const plan = (requests, options = {}) => planRuns(requests, { buildExists: slug => builds.has(slug), ...options });
const refused = (requests, message, options) => assert.throws(() => plan(requests, options), err => err instanceof PlanError && err.message === message);
// A matrix entry as the plan writes it: a run that spends also carries its key check's budget and the trial's share of its
// ceiling (tests/trial-ceiling.test.mjs checks those values), and a repeated run its rep last.
const entry = (build, trial, { rep, ...extra } = {}) => {
  const m = { build, trial, max_cost_usd: '5', model: 'claude-sonnet-5-5', concurrency: '1', verify_only: 'false', ...extra };
  if (m.verify_only === 'false') Object.assign(m, { key_check_budget_usd: KEY_CHECK_BUDGET_USD, trial_budget_usd: trialBudget(m.max_cost_usd) });
  return rep === undefined ? m : { ...m, rep };
};
const split = "A ceiling covers every paid call of its run. The key check keeps 0.5 USD of it: one tiny call, or two when the key is organisation-level, each with a budget of 0.25 USD, and the run stops before the trial unless a check gets the reply ok within its budget. The trial gets the rest%s. Claude Code holds each budget to its own cost estimate: the key check can pass its budget by the one reply that reaches it, and the trial can pass its budget by every agent run already under way when it is reached, up to the request's concurrency (1 unless the request says otherwise).";

test('a queue without repeat plans one run per request and summarises them in one table', () => {
  const { matrix, summary } = plan([
    { build: 'measured-delivery', trial: 'guild-smoke-v1', max_cost_usd: 3 },
    { build: 'lean-start', trial: 'calibration-shell-v1', max_cost_usd: '2.5', concurrency: 2 },
    { build: 'lean-start', trial: 'guild-smoke-v1', verify_only: true },
  ]);
  assert.equal(JSON.stringify(matrix), JSON.stringify([
    entry('measured-delivery', 'guild-smoke-v1', { max_cost_usd: '3' }),
    entry('lean-start', 'calibration-shell-v1', { max_cost_usd: '2.5', concurrency: '2' }),
    entry('lean-start', 'guild-smoke-v1', { verify_only: 'true' }),
  ]));
  assert.deepEqual(summary, [
    '| Build | Trial | Model | Ceiling | Trial budget |',
    '|---|---|---|---|---|',
    '| measured-delivery | guild-smoke-v1 | claude-sonnet-5-5 | 3 USD | 2.5 USD |',
    '| lean-start | calibration-shell-v1 | claude-sonnet-5-5 | 2.5 USD | 2 USD |',
    '| lean-start | guild-smoke-v1 | claude-sonnet-5-5 | verify only, runs nothing | none |',
    '',
    "Each run waits for the owner's approval in the trials environment. Ceilings total 5.5 USD.",
    '',
    split.replace('%s', ''),
  ]);
  assert.deepEqual(plan([]), { matrix: [], summary: ['No requests: no trial runs and nothing waits for approval.'] });
});

test('repeat 1, as a number, a string or null, is the same as no repeat', () => {
  const base = [{ build: 'measured-delivery', trial: 'guild-smoke-v1' }, { build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: 2 }];
  const expected = plan(base);
  for (const repeat of [1, '1', null, undefined]) {
    const result = plan(base.map(r => ({ ...r, repeat })));
    assert.equal(JSON.stringify(result.matrix), JSON.stringify(expected.matrix), `repeat ${repeat}`);
    assert.deepEqual(result.summary, expected.summary, `repeat ${repeat}`);
  }
  assert.ok(expected.matrix.every(m => !('rep' in m)));
});

test('repeat n expands one request into n runs numbered rep 1 to n, in order, next to the other requests', () => {
  const { matrix, summary } = plan([
    { build: 'measured-delivery', trial: 'client-deployment-v1', max_cost_usd: 3, repeat: 5 },
    { build: 'lean-start', trial: 'client-deployment-v1', max_cost_usd: '3', repeat: '2' },
    { build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: 0.75 },
    { build: 'measured-delivery', trial: 'guild-smoke-v1', verify_only: true, repeat: 2 },
  ]);
  assert.deepEqual(matrix, [
    ...['1', '2', '3', '4', '5'].map(rep => entry('measured-delivery', 'client-deployment-v1', { max_cost_usd: '3', rep })),
    ...['1', '2'].map(rep => entry('lean-start', 'client-deployment-v1', { max_cost_usd: '3', rep })),
    entry('lean-start', 'guild-smoke-v1', { max_cost_usd: '0.75' }),
    ...['1', '2'].map(rep => entry('measured-delivery', 'guild-smoke-v1', { verify_only: 'true', rep })),
  ]);
  // Each ceiling times its repeats: 3 x 5 + 3 x 2 + 0.75 x 1; a verify-only request spends nothing however often it runs.
  assert.deepEqual(summary, [
    '| Build | Trial | Model | Ceiling per run | Trial budget per run | Repeats |',
    '|---|---|---|---|---|---|',
    '| measured-delivery | client-deployment-v1 | claude-sonnet-5-5 | 3 USD | 2.5 USD | 5 |',
    '| lean-start | client-deployment-v1 | claude-sonnet-5-5 | 3 USD | 2.5 USD | 2 |',
    '| lean-start | guild-smoke-v1 | claude-sonnet-5-5 | 0.75 USD | 0.25 USD | 1 |',
    '| measured-delivery | guild-smoke-v1 | claude-sonnet-5-5 | verify only, runs nothing | none | 2 |',
    '',
    "Each run waits for the owner's approval in the trials environment, and a request's repeats run one after another. Ceilings total 21.75 USD, each ceiling times its repeats.",
    '',
    split.replace('%s', ', the same on every repeat'),
  ]);
});

test('the dispatch inputs take repeat as text', () => {
  const { matrix } = plan([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: '1', model: 'claude-sonnet-5-5', verify_only: 'false', repeat: '3' }], { dispatched: true });
  assert.deepEqual(matrix.map(m => m.rep), ['1', '2', '3']);
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', repeat: '9' }], 'the dispatch inputs: repeat must be a whole number from 1 to 5', { dispatched: true });
});

test('a repeat that is not a whole number from 1 to 5 is refused', () => {
  for (const repeat of [0, 6, 10, -1, 2.5, '2.0', '02', ' 2', '', 'two', true, false, [2], { n: 2 }]) {
    refused([{ build: 'lean-start', trial: 'guild-smoke-v1' }, { build: 'measured-delivery', trial: 'guild-smoke-v1', repeat }],
      `request 2 in .github/trial-queue.json: repeat must be a whole number from 1 to 5`);
  }
});

test('a second request for the same build and trial is refused, whatever else differs', () => {
  const first = { build: 'lean-start', trial: 'guild-smoke-v1' };
  const message = 'request 3 in .github/trial-queue.json: lean-start on guild-smoke-v1 is already request 1; ask for more runs of it with repeat instead';
  for (const second of [{}, { model: 'claude-opus-5-5' }, { max_cost_usd: 1, repeat: 2 }, { verify_only: true }]) {
    refused([first, { build: 'lean-start', trial: 'calibration-shell-v1' }, { ...first, ...second }], message);
  }
  // The same build on another trial, or another build on the same trial, is a different request.
  assert.equal(plan([first, { build: 'lean-start', trial: 'calibration-shell-v1' }, { build: 'measured-delivery', trial: 'guild-smoke-v1' }]).matrix.length, 3);
});

test('two runs that would upload under one artifact name are refused, naming both requests and the name', () => {
  const tail = 'two runs in one workflow cannot share an artifact name, so queue one of them separately';
  // The review's case: a trial whose slug ends in -rep1 next to a repeated request for the trial without it, in either order.
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', repeat: 2 }, { build: 'lean-start', trial: 'guild-smoke-v1-rep1' }],
    `request 2 in .github/trial-queue.json: lean-start on guild-smoke-v1-rep1 would upload as evidence-lean-start-guild-smoke-v1-rep1, the artifact name of request 1 (lean-start on guild-smoke-v1, run 1); ${tail}`);
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1-rep1' }, { build: 'lean-start', trial: 'guild-smoke-v1', repeat: 2 }],
    `request 2 in .github/trial-queue.json: lean-start on guild-smoke-v1, run 1 would upload as evidence-lean-start-guild-smoke-v1-rep1, the artifact name of request 1 (lean-start on guild-smoke-v1-rep1); ${tail}`);
  // A hyphen joins the build and the trial, so build lean on trial start-guild-smoke-v1 meets lean-start on guild-smoke-v1,
  // with or without repeats. The plan on main accepted such a pair, and its second upload would have failed.
  const withLean = { buildExists: slug => slug === 'lean' || builds.has(slug) };
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1' }, { build: 'lean', trial: 'start-guild-smoke-v1' }],
    `request 2 in .github/trial-queue.json: lean on start-guild-smoke-v1 would upload as evidence-lean-start-guild-smoke-v1, the artifact name of request 1 (lean-start on guild-smoke-v1); ${tail}`, withLean);
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', repeat: 3 }, { build: 'lean', trial: 'start-guild-smoke-v1', repeat: 3 }],
    `request 2 in .github/trial-queue.json: lean on start-guild-smoke-v1, run 1 would upload as evidence-lean-start-guild-smoke-v1-rep1, the artifact name of request 1 (lean-start on guild-smoke-v1, run 1); ${tail}`, withLean);
  // The first problem in queue order stops the plan: a clash in request 2 comes before an unknown field in request 3.
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', repeat: 2 }, { build: 'lean-start', trial: 'guild-smoke-v1-rep2' }, { build: 'lean-start', trial: 'calibration-shell-v1', colour: 'red' }],
    `request 2 in .github/trial-queue.json: lean-start on guild-smoke-v1-rep2 would upload as evidence-lean-start-guild-smoke-v1-rep2, the artifact name of request 1 (lean-start on guild-smoke-v1, run 2); ${tail}`);
});

test('runs whose artifact names differ are accepted, and single runs keep the names they always had', () => {
  const names = requests => plan(requests, { buildExists: slug => slug === 'lean' || builds.has(slug) }).matrix.map(artifactName);
  assert.deepEqual(names([{ build: 'measured-delivery', trial: 'guild-smoke-v1' }, { build: 'lean-start', trial: 'guild-smoke-v1' }, { build: 'lean-start', trial: 'calibration-shell-v1' }]),
    ['evidence-measured-delivery-guild-smoke-v1', 'evidence-lean-start-guild-smoke-v1', 'evidence-lean-start-calibration-shell-v1']);
  // A request with repeat 2 has no run 3, so a trial ending in -rep3 does not meet it; nor do other builds' repeats.
  assert.deepEqual(names([
    { build: 'lean-start', trial: 'guild-smoke-v1', repeat: 2 },
    { build: 'lean-start', trial: 'guild-smoke-v1-rep3' },
    { build: 'measured-delivery', trial: 'guild-smoke-v1', repeat: 2 },
    { build: 'lean', trial: 'start-calibration-shell-v1' },
  ]), [
    'evidence-lean-start-guild-smoke-v1-rep1', 'evidence-lean-start-guild-smoke-v1-rep2', 'evidence-lean-start-guild-smoke-v1-rep3',
    'evidence-measured-delivery-guild-smoke-v1-rep1', 'evidence-measured-delivery-guild-smoke-v1-rep2', 'evidence-lean-start-calibration-shell-v1',
  ]);
});

test('unknown fields and the other refusals still stop the plan', () => {
  const where = 'request 1 in .github/trial-queue.json';
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', repeats: 3 }], `${where}: unknown field repeats`);
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', rep: 2 }], `${where}: unknown field rep`);
  refused([{ build: 'missing-build', trial: 'guild-smoke-v1' }], `${where}: no build at bundles/missing-build`);
  refused([{ build: 'lean-start', trial: 'Guild Smoke' }], `${where}: the trial "Guild Smoke" is not a slug`);
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: 0 }], `${where}: max_cost_usd must be a positive number of US dollars`);
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', concurrency: 0 }], `${where}: concurrency must be a whole number of at least 1`);
  refused([{ build: 'lean-start', trial: 'guild-smoke-v1', verify_only: 'yes' }], `${where}: verify_only must be true or false`);
  refused(['lean-start'], `${where}: a request is an object`);
  refused({ requests: [] }, '.github/trial-queue.json needs a "requests" list');
});

test('the script writes the matrix and summary, and a refusal is a workflow error that stops the job', t => {
  const root = mkdtempSync(join(tmpdir(), 'bg-trial-plan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.github'));
  mkdirSync(join(root, 'bundles/lean-start'), { recursive: true });
  writeFileSync(join(root, 'bundles/lean-start/buildguild.json'), '{}');
  // Verify-only requests skip the published-trial check, so the script makes no request; the origin is unreachable anyway.
  const run = (queue, extra = {}) => {
    writeFileSync(join(root, '.github/trial-queue.json'), JSON.stringify(queue));
    for (const f of ['output', 'summary']) writeFileSync(join(root, f), '');
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: join(root, 'output'), GITHUB_STEP_SUMMARY: join(root, 'summary'), BUILDGUILD_ORIGIN: 'http://127.0.0.1:9', ...extra } });
    return { ...result, output: readFileSync(join(root, 'output'), 'utf8'), summary: readFileSync(join(root, 'summary'), 'utf8') };
  };
  const ok = run({ run: 1, requests: [{ build: 'lean-start', trial: 'guild-smoke-v1', verify_only: true, repeat: 2 }] });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const matrix = [1, 2].map(rep => entry('lean-start', 'guild-smoke-v1', { verify_only: 'true', rep: String(rep) }));
  assert.equal(ok.output, `matrix=${JSON.stringify(matrix)}\n`);
  assert.equal(ok.stdout, `matrix=${JSON.stringify(matrix)}\n`);
  assert.match(ok.summary, /^\| Build \| Trial \| Model \| Ceiling per run \| Trial budget per run \| Repeats \|\n/);
  assert.match(ok.summary, /Ceilings total 0 USD, each ceiling times its repeats\.\n$/);

  const empty = run({ run: 1, requests: [] });
  assert.equal(empty.status, 0);
  assert.equal(empty.output, 'matrix=[]\n');
  assert.equal(empty.summary, 'No requests: no trial runs and nothing waits for approval.\n');

  const bad = run({ run: 1, requests: [{ build: 'lean-start', trial: 'guild-smoke-v1', verify_only: true, repeat: 6 }] });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '::error::request 1 in .github/trial-queue.json: repeat must be a whole number from 1 to 5\n');
  assert.equal(bad.output, '');

  const dispatch = { GITHUB_EVENT_NAME: 'workflow_dispatch', BG_BUILD: 'lean-start', BG_TRIAL: 'guild-smoke-v1', BG_MAX_COST_USD: '5', BG_MODEL: 'claude-sonnet-5-5', BG_VERIFY_ONLY: 'true' };
  // An empty or absent repeat input is one run with no rep, as a dispatch was before.
  for (const repeat of [{}, { BG_REPEAT: '' }, { BG_REPEAT: '1' }]) {
    const once = run({}, { ...dispatch, ...repeat });
    assert.equal(once.output, `matrix=${JSON.stringify([entry('lean-start', 'guild-smoke-v1', { verify_only: 'true' })])}\n`);
  }
  assert.equal(JSON.parse(run({}, { ...dispatch, BG_REPEAT: '3' }).output.slice('matrix='.length)).length, 3);
});

test('the workflow calls the script, runs one job at a time and names a repeated run after its rep', () => {
  assert.match(workflow, /\n        run: node \.github\/scripts\/plan-trial-runs\.mjs\n/);
  assert.doesNotMatch(workflow, /node --input-type=module/);
  assert.match(workflow, /\n      max-parallel: 1\n/);
  assert.match(workflow, /\n      repeat:\n        description: [^\n]+\n        required: false\n        default: "1"\n/);
  assert.match(workflow, /\n          BG_REPEAT: \$\{\{ inputs\.repeat \}\}\n/);
  assert.equal(workflow.match(/BG_REP: \$\{\{ matrix\.rep \}\}/g).length, 3);
  assert.match(workflow, /--out "evidence-\$BG_BUILD-\$BG_TRIAL\$SUFFIX\.json" --raw-out "raw-\$BG_BUILD-\$BG_TRIAL\$SUFFIX\.json" --work-dir "\$RUNNER_TEMP\/trial-run" --keep-temp "\$\{REP_ARGS\[@\]\}"\n/);
  assert.match(workflow, /\n          EVIDENCE="evidence-\$BG_BUILD-\$BG_TRIAL\$SUFFIX\.json"\n/);
  assert.match(workflow, /\n          if \[ -f "raw-\$BG_BUILD-\$BG_TRIAL\$SUFFIX\.json" \]; then cp -L "raw-\$BG_BUILD-\$BG_TRIAL\$SUFFIX\.json" "\$OUT_DIR\/"; fi\n/);
  assert.match(workflow, /name: \$\{\{ steps\.shells\.outputs\.measurement != 'true' && 'not-' \|\| '' \}\}evidence-\$\{\{ matrix\.build \}\}-\$\{\{ matrix\.trial \}\}\$\{\{ matrix\.rep && format\('-rep\{0\}', matrix\.rep\) \|\| '' \}\}\n/);
});

// Evaluates a workflow line's expressions for the three forms its names use, and refuses any other form. As GitHub's
// contexts reference says, a matrix property the entry does not have, or a step output never set, reads as an empty
// string.
const evaluate = (line, matrix, outputs = { measurement: 'true' }) => line.replace(/\$\{\{ (.+?) \}\}/g, (_, expr) => {
  let m = expr.match(/^matrix\.([a-z_]+)$/);
  if (m) return matrix[m[1]] ?? '';
  m = expr.match(/^matrix\.([a-z_]+) && format\('([^']*)', matrix\.([a-z_]+)\) \|\| ''$/);
  if (m && m[1] === m[3]) return matrix[m[1]] ? m[2].replace('{0}', matrix[m[1]]) : '';
  m = expr.match(/^steps\.shells\.outputs\.([a-z_]+) != '([^']*)' && '([^']*)' \|\| ''$/);
  if (m) return (outputs[m[1]] ?? '') !== m[2] ? m[3] : '';
  throw new Error(`no evaluator for the expression ${expr}`);
});

test("the upload step names each artifact by the plan's rule, so the plan's name check covers what is uploaded", () => {
  const uploads = workflow.match(/\n {10}name: ([^\n]*evidence-[^\n]+)\n/g);
  assert.equal(uploads.length, 1);
  const line = uploads[0].trim().slice('name: '.length);
  for (const run of [
    entry('lean-start', 'guild-smoke-v1'),
    entry('lean-start', 'guild-smoke-v1', { rep: '1' }),
    entry('lean-start', 'guild-smoke-v1-rep1'),
    entry('measured-delivery', 'calibration-shell-v1', { rep: '5', verify_only: 'true' }),
  ]) {
    // Only a run the shell check called a measurement uploads under the plan's name; any other run, the check's output
    // missing included, takes the same name with not- in front, which is just as unique.
    assert.equal(evaluate(line, run, { measurement: 'true' }), artifactName(run), JSON.stringify(run));
    for (const measurement of ['false', '']) assert.equal(evaluate(line, run, { measurement }), `not-${artifactName(run)}`, JSON.stringify(run));
  }
});

test('the run step names files and passes --rep only for a repeated run', t => {
  // The step's own shell lines, run by bash with node replaced by a stub that prints its arguments.
  const step = workflow.slice(workflow.indexOf('          mkdir -p "$RUNNER_TEMP/evaltmp"'), workflow.indexOf("      - name: Check that the sandbox started the agents' shell commands"));
  const root = mkdtempSync(join(tmpdir(), 'bg-trial-step-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'node'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n', { mode: 0o700 });
  const argv = rep => {
    const r = spawnSync('bash', ['-e', '-c', step], { cwd: root, encoding: 'utf8', env: { PATH: `${root}:${process.env.PATH}`, RUNNER_TEMP: root, BG_BUILD: 'lean-start', BG_TRIAL: 'guild-smoke-v1', BG_TRIAL_BUDGET_USD: '2.5', BG_MODEL: 'claude-sonnet-5-5', BG_CONCURRENCY: '1', BG_REP: rep } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim().split('\n');
  };
  const before = ['cli/buildguild.mjs', 'test', 'bundles/lean-start', '--trial', 'guild-smoke-v1', '--max-cost-usd', '2.5', '--model', 'claude-sonnet-5-5', '-j', '1', '--runner', 'github-actions', '--role', 'guild', '--out', 'evidence-lean-start-guild-smoke-v1.json', '--raw-out', 'raw-lean-start-guild-smoke-v1.json', '--work-dir', `${root}/trial-run`, '--keep-temp'];
  assert.deepEqual(argv(''), before);
  assert.deepEqual(argv('4'), [...before.slice(0, 16), 'evidence-lean-start-guild-smoke-v1-rep4.json', '--raw-out', 'raw-lean-start-guild-smoke-v1-rep4.json', ...before.slice(19), '--rep', '4']);
  // The evidence and raw files carry the artifact's name, so a name the plan accepts is also unique for them.
  for (const rep of ['', '4']) {
    const args = argv(rep);
    const name = artifactName(entry('lean-start', 'guild-smoke-v1', rep ? { rep } : {}));
    assert.equal(args[args.indexOf('--out') + 1], `${name}.json`);
    assert.equal(args[args.indexOf('--raw-out') + 1], `raw${name.slice('evidence'.length)}.json`);
  }
});

async function cliSetup(t) {
  const root = mkdtempSync(join(tmpdir(), 'bg-trial-rep-'));
  const write = (relative, contents, mode = 0o600) => {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents), { mode });
  };
  const readme = 'This synthetic trial exercises the repeat number on evidence ids without any model access or external network calls. It has one local task and one deterministic grader, with enough words to pass the normal trial checks. All executables are stubs.';
  const trial = { schema: 'buildguild.trial.v1', slug: 'sample-trial', name: 'Sample trial', version: '1.0.0', kind: 'community', author: 'tester', license: 'Apache-2.0', summary: readme, categories: ['delivery'],
    cases: [{ name: 'case-name', dimension: 'quality', runs: 1 }], tolerance: { overall: 0.1 }, archive: 'TRIAL_ZIP' };
  write('build/buildguild.json', { slug: 'local-build', modules: [] });
  write('trial/trial.json', trial);
  write('trial/README.md', readme);
  write('trial/LICENSE', 'Apache-2.0');
  write('trial/cases/case-name/prompt.md', '---\ntags: [quality]\nallowed_tools: [Write]\n---\nWrite done.\n');
  write('trial/cases/case-name/graders/done.md', "---\ntype: regex\npattern: 'done'\n---\n");
  // A stored ZIP holding cases/case-name/prompt.md with "Write done.\n", as tests/module-pins.test.mjs uses.
  const zip = Buffer.from('UEsDBBQAAAAAAAAAIVzncEO0DAAAAAwAAAAZAAAAY2FzZXMvY2FzZS1uYW1lL3Byb21wdC5tZFdyaXRlIGRvbmUuClBLAQIUAxQAAAAAAAAAIVzncEO0DAAAAAwAAAAZAAAAAAAAAAAAAACAAQAAAABjYXNlcy9jYXNlLW5hbWUvcHJvbXB0Lm1kUEsFBgAAAAABAAEARwAAAEMAAAAAAA==', 'base64');
  const server = createServer((req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/trials/sample-trial.json') res.end(JSON.stringify({ ...trial, archive: `${origin}/trial.zip` }));
    else if (req.url === '/trial.zip') res.end(zip);
    else res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const raw = { claudeVersion: '2.1.314', aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1 }, cases: [{ name: 'case-name', aggregates: { score: 1, delta: 0 } }], costUsd: 0, durationSeconds: 1 };
  write('bin/which', `#!${process.execPath}\nconst { accessSync, constants } = require('node:fs'); const p = require('node:path').join(process.env.PATH, process.argv[2]); try { accessSync(p, constants.X_OK); console.log(p); } catch { process.exit(1); }\n`, 0o700);
  write('bin/claude', `#!${process.execPath}
const { appendFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.314 (Claude Code)'); process.exit(0); }
if (args[0] !== 'plugin' || args[1] !== 'eval') process.exit(90);
appendFileSync(${JSON.stringify(join(root, 'claude.log'))}, JSON.stringify(args) + '\\n');
writeFileSync(args[args.indexOf('--json') + 1], ${JSON.stringify(JSON.stringify(raw))});
`, 0o700);
  const env = { PATH: join(root, 'bin'), HOME: root, BUILDGUILD_ORIGIN: `http://127.0.0.1:${server.address().port}` };
  const invoke = args => new Promise(resolve => execFile(process.execPath, [cli, 'test', './build', '--model', 'claude-sonnet-5-5', '--runner', 'tester', '--work-dir', './work', ...args], { cwd: root, env, timeout: 25000 },
    (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr })));
  const json = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
  const claudeCalls = () => existsSync(join(root, 'claude.log')) ? readFileSync(join(root, 'claude.log'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, invoke, json, claudeCalls };
}

const ID = /^\d{4}-\d{2}-\d{2}-tester-[a-z0-9]{1,6}$/;

test('without --rep a run keeps its id and file names', async t => {
  const f = await cliSetup(t);
  for (const [trial, file] of [['./trial', 'local-run.json'], ['sample-trial', 'evidence.json']]) {
    const result = await f.invoke(['--trial', trial]);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(f.json(file).id, ID);
  }
  assert.ok(!existsSync(join(f.root, 'evidence-rep1.json')) && !existsSync(join(f.root, 'local-run-rep1.json')));
});

test('--rep k ends the evidence id and the default file name in -rep<k>, and changes nothing the runner is given', async t => {
  const f = await cliSetup(t);
  const local = await f.invoke(['--trial', './trial', '--rep', '2']);
  assert.equal(local.status, 0, local.stderr + local.stdout);
  const record = f.json('local-run-rep2.json');
  assert.match(record.id, /^\d{4}-\d{2}-\d{2}-tester-[a-z0-9]{1,6}-rep2$/);
  assert.equal(record.trialSource, 'local');
  assert.ok(!existsSync(join(f.root, 'local-run.json')));

  const published = await f.invoke(['--trial', 'sample-trial', '--rep', '3']);
  assert.equal(published.status, 0, published.stderr + published.stdout);
  assert.match(f.json('evidence-rep3.json').id, /-rep3$/);
  assert.match(published.stdout, /\nnext: node cli\/buildguild\.mjs submit evidence-rep3\.json\n/);

  // The workflow's own order: named files, then --keep-temp, then --rep.
  const hosted = await f.invoke(['--trial', 'sample-trial', '--out', 'evidence-local-build-sample-trial-rep4.json', '--raw-out', 'raw-local-build-sample-trial-rep4.json', '--keep-temp', '--rep', '4']);
  assert.equal(hosted.status, 0, hosted.stderr + hosted.stdout);
  assert.match(f.json('evidence-local-build-sample-trial-rep4.json').id, /-rep4$/);
  assert.ok(existsSync(join(f.root, 'raw-local-build-sample-trial-rep4.json')));

  const calls = f.claudeCalls();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], calls[1]);
  assert.ok(calls.every(argv => !argv.some(a => /rep/.test(a))));
  assert.deepEqual(calls[2], [...calls[1], '--keep-temp']);
});

test('--rep that is not a whole number of at least 1 is refused before anything runs', async t => {
  const f = await cliSetup(t);
  for (const value of [['0'], ['x'], ['1.5'], ['-2'], []]) {
    const result = await f.invoke(['--trial', './trial', '--rep', ...value]);
    assert.equal(result.status, 1, `--rep ${value}`);
    assert.equal(result.stderr, 'buildguild: --rep needs a whole number of at least 1; nothing was run\n');
  }
  assert.deepEqual(f.claudeCalls(), []);
  assert.ok(!existsSync(join(f.root, 'work')));
});

test('buildguild test hands its --max-cost-usd to the eval runner as given, so the trial budget is the eval ceiling', async t => {
  const f = await cliSetup(t);
  const result = await f.invoke(['--trial', 'sample-trial', '--max-cost-usd', '2.5']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const [argv] = f.claudeCalls();
  assert.equal(argv.filter(a => a === '--max-cost-usd').length, 1);
  assert.equal(argv[argv.indexOf('--max-cost-usd') + 1], '2.5');
});
