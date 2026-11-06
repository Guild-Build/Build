import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const readme = 'This comparison fixture documents the local sample build and trial. It contains a synthetic task for exercising the command line workflow and enough documentation to satisfy validation. The fixture only uses locally generated data and can be run repeatedly in an isolated temporary folder.';
const stub = `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.309 (Claude Code)'); process.exit(0); }
if (args[1] === 'validate') process.exit(0);
if (args.includes('--help')) {
  console.log('--eval-dir --ablation --runs --max-cost-usd --no-publish');
  process.exit(0);
}
const label = basename(process.cwd());
const value = flag => args[args.indexOf(flag) + 1];
const prompt = readFileSync(join(value('--eval-dir'), 'case-name/prompt.md'), 'utf8');
appendFileSync(process.env.BG_COMPARE_LOG, JSON.stringify({ args, label, prompt }) + '\\n');
if (label === 'incumbent' && process.env.BG_COMPARE_SCENARIO === 'missing') process.exit(1);
if (label === 'incumbent' && process.env.BG_COMPARE_SCENARIO === 'mutated') {
  appendFileSync('../../inputs/candidate/skills/local-skill/SKILL.md', 'Mutated by first run.');
}
const disabled = label === 'candidate' && process.env.BG_COMPARE_SCENARIO === 'plugin-disabled';
const acceptance = label === 'candidate';
const { name, version } = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
const plugin = { name, version, path: process.cwd(), ...(disabled ? { problem: 'disabled_by_default' } : {}) };
const grader = { name: 'file', type: 'file_exists', weight: 1 };
const arm = {
  score: Number(acceptance), passed: acceptance, error: null, skippedPaidGraders: false,
  costUsd: 0.01, judgeCostUsd: 0, durationSeconds: 1,
  graders: [{ name: grader.name, passed: acceptance, weight: 1, scored: true, withOnly: false }],
};
const partial = label === 'incumbent' && process.env.BG_COMPARE_SCENARIO === 'partial';
const report = {
  schemaVersion: 1, claudeVersion: '2.1.309', partial,
  suite: { root: process.cwd(), ablation: value('--ablation'), modelOverride: value('--model'),
    concurrency: Number(value('-j')), plugins: [plugin] },
  costUsd: partial ? 0.75 : 0.1, durationSeconds: 5,
  cases: [{ name: 'case-name', runsPerCase: Number(value('--runs')), graders: [grader],
    arms: { with: Array.from({ length: partial ? 1 : Number(value('--runs')) }, () => arm) } }],
};
writeFileSync(value('--json'), JSON.stringify(report));
if (partial) process.exit(2);
if (arm.score < Number(value('--threshold'))) process.exit(1);
`;

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'bg-compare-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (relative, contents, mode = 0o600) => {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof contents === 'string' ? contents : JSON.stringify(contents), { mode });
  };
  for (const slug of ['incumbent', 'candidate']) {
    write(`${slug}/.claude-plugin/plugin.json`, { name: slug, version: '1.0.0', description: readme, experimental: { evals: 'ignored-suite' } });
    write(`${slug}/buildguild.json`, {
      schema: 'buildguild.build.v1', slug, name: slug, summary: readme.slice(0, 100),
      license: 'Apache-2.0', version: '1.0.0', branches: ['claude-code'], category: 'delivery',
      modules: ['skill/local-skill'],
      agentProfiles: [{ role: 'builder', model: 'test-model', effort: 'high', tools: 'Read', limits: 'Only use the local fixture.' }],
    });
    write(`${slug}/README.md`, readme);
    write(`${slug}/LICENSE`, 'Apache-2.0');
    write(`${slug}/skills/local-skill/SKILL.md`, '---\nname: local-skill\ndescription: Local test skill\n---\nSynthetic test.');
  }
  write('incumbent/.git/config', '[core]\n');
  write('incumbent/evals/obsolete/graders/broken.md', 'invalid old grader');
  write('trial/trial.json', {
    schema: 'buildguild.trial.v1', slug: 'local-trial', name: '<em>Local trial</em>', version: '1.0.0',
    kind: 'community', author: 'tester', license: 'Apache-2.0', summary: readme, categories: ['delivery'],
    cases: [{ name: 'case-name', dimension: 'quality', runs: 1 }], tolerance: { overall: 0.1 },
  });
  write('trial/README.md', readme);
  write('trial/LICENSE', 'Apache-2.0');
  write('trial/cases/case-name/case.yaml', 'schema_version: "1.1"\nname: case-name\ncontext:\n  scaffold_script: fixture.sh\n');
  write('trial/cases/case-name/fixture.sh', 'touch "$BG_COMPARE_FIXTURE_MARKER"\nexit 90\n', 0o700);
  write('trial/cases/case-name/prompt.md', '---\ntags: [quality]\nallowed_tools: [Write]\n---\nCreate result.txt.\n');
  write('trial/cases/case-name/graders/file.md', '---\ntype: file_exists\npath: result.txt\n---\n');
  write('bin/claude', `#!${process.execPath}\n${stub}`, 0o700);
  const log = join(root, 'claude.log');
  const fixtureMarker = join(root, 'fixture-ran');
  const out = join(root, 'output');
  const run = (scenario = '', extra = [], target = out) => spawnSync(process.execPath, [
    cli, 'compare', 'incumbent', 'candidate', '--trial', './trial', '--model', 'test-model',
    '--max-cost-usd', '1', '--out', target, ...extra,
  ], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      BG_COMPARE_LOG: log, BG_COMPARE_FIXTURE_MARKER: fixtureMarker, BG_COMPARE_SCENARIO: scenario },
  });
  return {
    root, out, fixtureMarker, run,
    calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
    report: () => JSON.parse(readFileSync(join(out, 'comparison.json'), 'utf8')),
  };
}

function expectExit(result, status) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, result.stderr + result.stdout);
}

test('compares both local builds on the same staged trial and keeps results private', t => {
  const fixture = setup(t);
  expectExit(fixture.run(), 0);
  const calls = fixture.calls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.label), ['incumbent', 'candidate']);
  for (const { args, prompt } of calls) {
    assert.match(prompt, /Create result\.txt/);
    for (const [flag, value] of [
      ['--eval-dir', 'evals'], ['--ablation', 'none'], ['--runs', '3'],
      ['--model', 'test-model'], ['--max-cost-usd', '0.5'],
    ]) {
      assert.ok(args.includes(flag), flag);
      assert.equal(args[args.indexOf(flag) + 1], value);
    }
    assert.ok(args.includes('--no-publish'));
  }
  const report = fixture.report();
  assert.equal(report.status, 'complete');
  assert.equal(report.visibility, 'private');
  assert.equal(report.incumbent.result.counts.accepted, 0);
  assert.equal(report.candidate.result.counts.accepted, 3);
  assert.match(report.trial.sha256, /^[a-f0-9]{64}$/);
  const html = readFileSync(join(fixture.out, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /<em>Local trial<\/em>/);
  assert.equal(existsSync(fixture.fixtureMarker), false);
  assert.equal(existsSync(join(fixture.out, 'inputs/incumbent/.git')), false);
  assert.equal(readFileSync(join(fixture.root, 'incumbent/evals/obsolete/graders/broken.md'), 'utf8'), 'invalid old grader');
  assert.equal(existsSync(join(fixture.out, 'inputs/incumbent/evals')), false);
  const submit = spawnSync(process.execPath, [cli, 'submit', join(fixture.out, 'comparison.json'), '--yes'], { encoding: 'utf8' });
  expectExit(submit, 1);
  assert.match(submit.stderr, /evidence|private/i);
  expectExit(fixture.run(), 1);
  assert.equal(fixture.calls().length, 2);
  assert.deepEqual(fixture.report(), report);
});

test('preserves partial attempts and skips the candidate when equal budgets are unavailable', t => {
  const fixture = setup(t);
  expectExit(fixture.run('partial'), 2);
  assert.equal(fixture.calls().length, 1);
  const report = fixture.report();
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.incumbent.result.counts.missing, 2);
  assert.equal(report.candidate.result.counts.planned, 3);
  assert.equal(report.candidate.result.counts.completed, 0);
  assert.match(report.candidate.result.issues.join(' '), /remaining budget/i);
});

test('ignores a stale report in the incumbent build when the runner writes no fresh result', t => {
  const fixture = setup(t);
  const grader = { name: 'file', type: 'file_exists', weight: 1 };
  const stagedPath = join(realpathSync(fixture.root), 'output/work/incumbent');
  const stale = {
    suite: { root: stagedPath, ablation: 'none', modelOverride: 'test-model',
      concurrency: 1, plugins: [{ name: 'incumbent', version: '1.0.0', path: stagedPath }] },
    schemaVersion: 1, claudeVersion: '2.1.309', partial: false, costUsd: 0.1, durationSeconds: 5,
    cases: [{
      name: 'case-name', runsPerCase: 3, graders: [grader],
      arms: { with: Array.from({ length: 3 }, () => ({
        score: 1, passed: true, error: null, skippedPaidGraders: false,
        costUsd: 0.01, judgeCostUsd: 0, durationSeconds: 1,
        graders: [{ name: 'file', passed: true, weight: 1, scored: true, withOnly: false }],
      })) },
    }],
  };
  writeFileSync(join(fixture.root, 'incumbent/raw.json'), JSON.stringify(stale));
  expectExit(fixture.run('missing'), 2);
  assert.equal(fixture.calls().length, 1);
  const report = fixture.report();
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.incumbent.result.costUsd, null);
  assert.equal(report.incumbent.result.counts.missing, 3);
  assert.deepEqual(JSON.parse(readFileSync(join(fixture.root, 'incumbent/raw.json'), 'utf8')), stale);
  assert.equal(report.candidate.result.counts.planned, 3);
  assert.equal(report.candidate.result.counts.completed, 0);
  assert.match(report.candidate.result.issues.join(' '), /spend is unknown/i);
});

test('refuses unsafe inputs and unsupported options before any evaluation starts', t => {
  const fixture = setup(t);
  expectExit(fixture.run('', ['--effort', 'high']), 1);
  expectExit(fixture.run('', [], join(fixture.root, 'candidate/output')), 1);
  symlinkSync('../trial', join(fixture.root, 'incumbent', 'external-link'));
  expectExit(fixture.run(), 1);
  assert.equal(fixture.calls().length, 0);
  assert.equal(existsSync(fixture.fixtureMarker), false);
});

test('invalidates a comparison if a runner mutates retained inputs', t => {
  const fixture = setup(t);
  const skill = 'candidate/skills/local-skill/SKILL.md';
  const original = readFileSync(join(fixture.root, skill), 'utf8');
  expectExit(fixture.run('mutated'), 2);
  assert.deepEqual(fixture.calls().map(call => call.label), ['incumbent']);
  const report = fixture.report();
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.acceptanceDelta, null);
  assert.equal(report.incumbent.result.complete, false);
  assert.equal(report.candidate.result.counts.completed, 0);
  assert.match(report.incumbent.result.issues.join(' '), /input.*chang|chang.*input|mutat/i);
  assert.equal(readFileSync(join(fixture.root, skill), 'utf8'), original);
  assert.equal(readFileSync(join(fixture.out, 'inputs', skill), 'utf8'), original + 'Mutated by first run.');
});

test('reports a disabled candidate plugin as inconclusive despite passing grades', t => {
  const fixture = setup(t);
  expectExit(fixture.run('plugin-disabled'), 2);
  assert.deepEqual(fixture.calls().map(call => call.label), ['incumbent', 'candidate']);
  const report = fixture.report();
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.acceptanceDelta, null);
  assert.equal(report.candidate.result.counts.accepted, 0);
  assert.match(report.candidate.result.issues.join(' '), /plugin/i);
});
