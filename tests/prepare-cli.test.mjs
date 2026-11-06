import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runnerTracePrefix } from '../cli/comparison-responses.mjs';

const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const fixtureDocs = 'This synthetic build and trial exercise offline preparation. The review contains a task prompt and the deterministic check it will use. The fixtures are kept small so the test can verify the frozen inputs, budget and execution settings directly. All contents are generated locally.';
const prompt = '---\ntags: [quality]\nallowed_tools: [Write]\n---\nCreate result.txt. The literal string <script> is test data.\n';
const caseYaml = 'schema_version: "1.1"\nname: case-name\ncontext:\n  scaffold_script: fixture.sh\n';
const grader = '---\ntype: file_exists\npath: result.txt\n---\n';
const traceBase = realpathSync(process.platform === 'darwin' ? '/tmp' : tmpdir());
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

const runner = String.raw`
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const settings = flag => args[args.indexOf(flag) + 1];
const env = process.env;
appendFileSync(env.BG_RUNNER_LOG, JSON.stringify(args) + '\n');
if (args[0] === '--version') {
  console.log('2.1.314 (Claude Code)');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('--eval-dir --ablation --runs --max-cost-usd --no-publish --keep-temp');
  process.exit(0);
}
if (args[1] !== 'eval') process.exit(1);
const cwd = process.cwd();
const { name, version } = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
const graders = [{ name: 'file', type: 'file_exists', weight: 1 }];
const attempts = Array.from({ length: Number(settings('--runs')) }, () => {
  const directory = mkdtempSync(join(env.BG_TRACE_BASE, env.BG_TRACE_PREFIX));
  appendFileSync(env.BG_TRACE_LOG, directory + '\n');
  mkdirSync(join(directory, 'out'), { mode: 0o700 });
  const tracePath = join(directory, 'out/trace.jsonl');
  const final = readFileSync(join(settings('--eval-dir'), 'case-name/prompt.md'), 'utf8');
  const rows = [
    { type: 'assistant', message: { content: [{ type: 'text', text: final }] } },
    { type: 'result', subtype: 'success', is_error: false, result: final },
  ];
  writeFileSync(tracePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  return { score: 1, passed: true, error: null, skippedPaidGraders: false, costUsd: 0.01,
    judgeCostUsd: 0, durationSeconds: 1, tracePath,
    graders: [{ name: 'file', passed: true, weight: 1, scored: true, withOnly: false }] };
});
const report = { schemaVersion: 1, claudeVersion: '2.1.314', partial: false,
  suite: { root: cwd, ablation: settings('--ablation'), modelOverride: settings('--model'),
    concurrency: Number(settings('-j')), plugins: [{ name, version, path: cwd }] },
  costUsd: 0.1, durationSeconds: 3,
  cases: [{ name: 'case-name', runsPerCase: 1, graders, arms: { with: attempts } }],
};
writeFileSync(settings('--json'), JSON.stringify(report));
`;

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'bg-prepare-test-'));
  const log = join(root, 'runner.log');
  const traces = join(root, 'trace-roots.log');
  const prefix = runnerTracePrefix();
  t.after(() => {
    if (existsSync(traces)) {
      for (const path of readFileSync(traces, 'utf8').trim().split('\n')) {
        assert.equal(dirname(path), traceBase);
        assert.match(basename(path), new RegExp('^' + prefix + '[a-z0-9]{6}$', 'i'));
        rmSync(path, { recursive: true, force: true });
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  const write = (relative, contents, mode = 0o600) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents), { mode });
  };
  for (const slug of ['incumbent', 'candidate']) {
    write(slug + '/.claude-plugin/plugin.json', { name: slug, version: '1.0.0', description: fixtureDocs });
    write(slug + '/buildguild.json', {
      schema: 'buildguild.build.v1', slug, name: slug, summary: fixtureDocs,
      license: 'Apache-2.0', version: '1.0.0', branches: ['claude-code'], category: 'delivery',
      modules: ['skill/local-skill'],
      agentProfiles: [{ role: 'builder', model: 'test-model', effort: 'high', tools: 'Read', limits: 'Only use the local fixture.' }],
    });
    write(slug + '/README.md', fixtureDocs);
    write(slug + '/LICENSE', 'Apache-2.0');
    write(slug + '/skills/local-skill/SKILL.md', '---\nname: local-skill\ndescription: Synthetic skill\n---\nSynthetic text.\n');
  }
  write('trial/trial.json', { schema: 'buildguild.trial.v1', slug: 'local-trial', name: 'Local trial',
    version: '1.0.0', kind: 'community', author: 'tester', license: 'Apache-2.0',
    summary: fixtureDocs, categories: ['delivery'], cases: [{ name: 'case-name', dimension: 'quality', runs: 1 }],
    tolerance: { overall: 0.1 } });
  write('trial/README.md', fixtureDocs);
  write('trial/LICENSE', 'Apache-2.0');
  write('trial/cases/case-name/case.yaml', caseYaml);
  write('trial/cases/case-name/fixture.sh', 'touch "$BG_FIXTURE_MARKER"\nexit 90\n', 0o700);
  write('trial/cases/case-name/prompt.md', prompt);
  write('trial/cases/case-name/graders/file.md', grader);
  write('bin/claude', '#!' + process.execPath + '\n' + runner, 0o700);
  const review = join(root, 'review');
  const planPath = join(review, 'plan.json');
  const out = join(root, 'run');
  const invoke = (args, withRunner = true) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PATH: withRunner ? join(root, 'bin') + ':' + process.env.PATH : join(root, 'no-bin'),
      BG_RUNNER_LOG: log, BG_TRACE_LOG: traces, BG_TRACE_BASE: traceBase, BG_TRACE_PREFIX: prefix,
      BG_FIXTURE_MARKER: join(root, 'fixture-ran') },
  });
  return { root, review, out, planPath, write,
    prepare: (withRunner = true, target = review) => invoke(['prepare', 'incumbent', 'candidate', '--trial', './trial',
      '--model', 'test-model', '--runs', '3', '--max-cost-usd', '1', '--out', target], withRunner),
    compare: (digest, extra = []) => invoke(['compare', '--plan', planPath, '--plan-sha256', digest, '--out', out, ...extra]),
    compareDirect: () => invoke(['compare', 'incumbent', 'candidate', '--trial', './trial',
      '--model', 'test-model', '--runs', '3', '--max-cost-usd', '1', '--out', out]),
    calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
  };
}

function expectExit(result, status) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, result.stderr + result.stdout);
}

test('prepares an inspectable local plan without Claude or fixture execution', t => {
  const f = setup(t);
  const result = f.prepare(false);
  expectExit(result, 0);
  const bytes = readFileSync(f.planPath);
  const plan = JSON.parse(bytes);
  assert.equal(plan.schema, 'buildguild.comparison-preparation.v1');
  assert.equal(plan.settings.model, 'test-model');
  assert.equal(plan.settings.runs, 3);
  assert.equal(plan.settings.requestedMaxCostUsd, 1);
  assert.equal(plan.settings.requiredRunnerVersion, '2.1.314');
  assert.equal(plan.totalAttempts, 6);
  assert.deepEqual(plan.allocatedMaxCostUsd, [0.5, 0.5]);
  assert.deepEqual(plan.trial.cases.map(({ name }) => name), ['case-name']);
  assert.equal(plan.tasks[0].promptMarkdown, prompt);
  assert.equal(plan.tasks[0].caseYaml, caseYaml);
  assert.equal(plan.tasks[0].graders[0].markdown, grader);
  assert.equal(readFileSync(join(f.review, 'inputs/trial/cases/case-name/prompt.md'), 'utf8'), prompt);
  const html = readFileSync(join(f.review, 'review.html'), 'utf8');
  assert.match(html, /Create result\.txt/);
  assert.match(html, /scaffold_script: fixture\.sh/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes(sha(bytes)));
  assert.ok(result.stdout.includes(sha(bytes)));
  assert.equal(existsSync(join(f.review, 'runs')), false);
  assert.equal(existsSync(join(f.root, 'fixture-ran')), false);
  assert.deepEqual(f.calls(), []);
});

test('runs only the frozen inputs and approved settings from a prepared comparison', t => {
  const f = setup(t);
  expectExit(f.prepare(), 0);
  assert.deepEqual(f.calls(), []);
  const planBytes = readFileSync(f.planPath);
  f.write('trial/cases/case-name/prompt.md', 'The original source changed after preparation.');
  f.write('candidate/skills/local-skill/SKILL.md', 'The original candidate changed after preparation.');
  expectExit(f.compare(sha(planBytes)), 0);
  const calls = f.calls().filter(args => args[1] === 'eval' && !args.includes('--help'));
  assert.equal(calls.length, 2);
  for (const args of calls) {
    for (const [flag, value] of [['--model', 'test-model'], ['--runs', '3'], ['--max-cost-usd', '0.5']]) {
      assert.ok(args.includes(flag));
      assert.equal(args[args.indexOf(flag) + 1], value);
    }
  }
  const runPlan = JSON.parse(readFileSync(join(f.out, 'plan.json'), 'utf8'));
  assert.equal(runPlan.preparationSha256, sha(planBytes));
  assert.deepEqual(runPlan.builds.map(build => build.sha256), JSON.parse(planBytes).builds.map(build => build.sha256));
  const report = JSON.parse(readFileSync(join(f.out, 'comparison.json'), 'utf8'));
  assert.equal(report.status, 'complete');
  for (const arm of ['incumbent', 'candidate']) {
    assert.equal(report[arm].result.responseEvidence.cases[0].attempts[0].finalResponse, prompt);
  }
  assert.deepEqual(readFileSync(f.planPath), planBytes);
});

test('rejects altered plan bytes, frozen snapshots and prepared-route overrides before invoking the runner', t => {
  const f = setup(t);
  expectExit(f.prepare(), 0);
  const bytes = readFileSync(f.planPath);
  const digest = sha(bytes);
  expectExit(f.compare(digest, ['--max-cost-usd', '9']), 1);
  const plan = JSON.parse(bytes);
  plan.settings.requestedMaxCostUsd = 9;
  writeFileSync(f.planPath, JSON.stringify(plan));
  expectExit(f.compare(digest), 1);
  const marker = join(f.root, 'serialized-command-ran');
  const unexpected = JSON.stringify({ ...JSON.parse(bytes), command: 'touch "' + marker + '"' });
  writeFileSync(f.planPath, unexpected);
  expectExit(f.compare(sha(unexpected)), 1);
  assert.equal(existsSync(marker), false);
  writeFileSync(f.planPath, bytes);
  writeFileSync(join(f.review, 'inputs/candidate/skills/local-skill/SKILL.md'), 'Altered frozen input.');
  expectExit(f.compare(digest), 1);
  assert.deepEqual(f.calls(), []);
  assert.equal(existsSync(f.out), false);
});

test('refuses to overwrite a preparation or place it inside an input', t => {
  const f = setup(t);
  expectExit(f.prepare(), 0);
  const bytes = readFileSync(f.planPath);
  expectExit(f.prepare(), 1);
  const overlap = join(f.root, 'candidate/review');
  expectExit(f.prepare(true, overlap), 1);
  assert.equal(existsSync(overlap), false);
  assert.deepEqual(readFileSync(f.planPath), bytes);
  assert.deepEqual(f.calls(), []);
});

test('rejects case YAML outside the reviewed deterministic format before invoking Claude', async t => {
  const yamlPath = 'trial/cases/case-name/case.yaml';
  for (const [name, change] of [
    ['system prompt and inline paid grader', f => f.write(yamlPath,
      caseYaml + 'execution:\n  append_system_prompt: Override the reviewed prompt\ngraders:\n  - type: llm\n')],
    ['quoted or escaped graders key', f => f.write(yamlPath, caseYaml + '"gr\\u0061ders": []\n')],
    ['flow mapping and alias', f => f.write(yamlPath, 'schema_version: "1.1"\nname: case-name\ncontext: &ctx {scaffold_script: fixture.sh}\ncopy: *ctx\n')],
    ['mismatched case name', f => f.write(yamlPath, caseYaml.replace('name: case-name', 'name: another-case'))],
    ['duplicate case name', f => f.write(yamlPath, caseYaml + 'name: case-name\n')],
    ['missing prompt file', f => rmSync(join(f.root, 'trial/cases/case-name/prompt.md'))],
  ]) {
    await t.test(name, subtest => {
      const f = setup(subtest);
      change(f);
      expectExit(f.prepare(), 1);
      expectExit(f.compareDirect(), 1);
      assert.deepEqual(f.calls(), []);
      assert.equal(existsSync(f.review), false);
      assert.equal(existsSync(f.out), false);
    });
  }
});
