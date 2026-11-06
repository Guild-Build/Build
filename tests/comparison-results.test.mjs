import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparison, normalizeRun, renderComparison } from '../cli/comparison-results.mjs';

const cases = [{ name: 'detect-bug', dimension: 'quality', graderNames: ['finding'] }];
const plugin = { name: 'current', version: '1.0.0', path: '/work/plugin' };
const model = 'pinned-model';
const runOptions = { cases, runs: 2, exitCode: 0, runnerVersion: '2.1.309 (Claude Code)', plugin, model };
const arm = (passed = true) => ({
  score: passed ? 1 : 0,
  passed,
  error: null,
  skippedPaidGraders: false,
  costUsd: 0.02,
  judgeCostUsd: 0,
  durationSeconds: 3,
  graders: [{ name: 'finding', scored: true, passed }],
});
const runnerReport = (withArms = [arm(), arm()]) => ({
  schemaVersion: 1,
  claudeVersion: '2.1.309',
  partial: false,
  suite: { root: plugin.path, ablation: 'none', modelOverride: model, concurrency: 1, plugins: [{ ...plugin }] },
  costUsd: 0.04,
  durationSeconds: 8,
  cases: [{ name: 'detect-bug', runsPerCase: 2, graders: [{ name: 'finding' }], arms: { with: withArms } }],
  aggregates: { casesPassed: 1 },
});
const comparison = (current, candidate, settings = {}) => createComparison({
  trial: { slug: 'team-tasks', version: '1', sha256: 'trial-hash' },
  settings: { model: 'pinned-model', runs: 2, ...settings },
  incumbent: { build: { slug: 'current', version: '1', sha256: 'current-hash' }, result: current },
  candidate: { build: { slug: '<script>alert(1)</script>', version: '2', sha256: 'candidate-hash' }, result: candidate },
  rerun: 'buildguild compare "A & B" current',
});

test('compares acceptance per attempt, ignoring suite-level pass counts', () => {
  const current = normalizeRun(runnerReport(), runOptions);
  const candidate = normalizeRun(runnerReport([arm(true), arm(false)]), runOptions);
  const report = comparison(current, candidate);
  assert.equal(report.status, 'complete');
  assert.equal(candidate.acceptanceRate, 0.5);
  assert.equal(report.acceptanceDelta, -0.5);
  assert.equal(report.caseDeltas[0].acceptanceDelta, -0.5);
  assert.equal(report.costUsd, 0.08);
});

test('accounts for missing, infrastructure-error and ungraded attempts without guessing costs', () => {
  const raw = runnerReport([{ ...arm(), error: 'secret detail', costUsd: null }, null, {
    ...arm(), graders: [{ name: 'finding', scored: false, passed: true }],
  }]);
  raw.cases[0].runsPerCase = 3;
  raw.costUsd = null;
  raw.partial = true;
  const result = normalizeRun(raw, { ...runOptions, runs: 3, exitCode: 2 });
  assert.deepEqual(result.counts, {
    planned: 3, completed: 1, graded: 0, accepted: 0, failed: 0, missing: 1, errors: 1, ungraded: 1,
  });
  assert.deepEqual(result.cases[0].attempts.map(row => row.status), ['error', 'missing', 'ungraded']);
  assert.equal(result.cases[0].attempts[0].costUsd, null);
  assert.equal(result.costPerAcceptedUsd, null);
  assert.equal(result.complete, false);
  assert.ok(!JSON.stringify(result).includes('secret detail'));
});

test('does not infer an advantage when a run is missing or incomplete', () => {
  const current = normalizeRun(null, { ...runOptions, exitCode: null });
  const proposed = normalizeRun(runnerReport(), runOptions);
  const report = comparison(current, proposed);
  assert.equal(current.counts.missing, 2);
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.acceptanceDelta, null);
  assert.equal(report.caseDeltas[0].acceptanceDelta, null);
  assert.equal(report.costUsd, null);
});

test('rejects mismatched runner versions, schemas and grader rosters', () => {
  const wrongVersion = normalizeRun({ ...runnerReport(), claudeVersion: '2.1.310' }, runOptions);
  assert.equal(wrongVersion.complete, false);
  assert.equal(wrongVersion.costUsd, null);
  const wrongSchema = normalizeRun({ ...runnerReport(), schemaVersion: 2 }, runOptions);
  assert.equal(wrongSchema.counts.missing, 2);
  assert.equal(wrongSchema.costUsd, null);
  assert.equal(wrongSchema.durationSeconds, null);
  const raw = runnerReport();
  raw.cases[0].graders = [{ name: 'unexpected-grader' }];
  assert.equal(normalizeRun(raw, runOptions).counts.ungraded, 2);
  raw.cases.push(raw.cases[0]);
  assert.equal(normalizeRun(raw, runOptions).counts.missing, 2);
});

test('leaves cost per success unknown when nothing passed and escapes report values', () => {
  const current = normalizeRun(runnerReport([arm(false), arm(false)]), runOptions);
  const report = comparison(current, current);
  assert.equal(current.costPerAcceptedUsd, null);
  const html = renderComparison(report);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot;A &amp; B&quot;/);
  assert.doesNotMatch(html, /<script[ >]/);
  assert.match(html, /Cost per accepted attempt<\/th><td>Unknown<\/td>/);
});

test('accepts exit 1 only when a complete report explains it with failed acceptance', () => {
  const options = { ...runOptions, exitCode: 1 };
  assert.equal(normalizeRun(runnerReport([arm(false), arm()]), options).complete, true);
  assert.equal(normalizeRun(runnerReport(), options).complete, false);
  assert.equal(normalizeRun(runnerReport([arm(false)]), options).complete, false);
});

test('leaves comparisons inconclusive when either run omits cost or duration', () => {
  const current = normalizeRun(runnerReport(), runOptions);
  for (const metric of ['costUsd', 'durationSeconds']) {
    const proposed = normalizeRun({ ...runnerReport(), [metric]: null }, runOptions);
    assert.equal(proposed[metric], null);
    assert.equal(comparison(current, proposed).status, 'inconclusive');
  }
});

test('requires the runner to report the intended plugin and suite settings', () => {
  for (const changes of [
    { plugins: [] },
    { plugins: [{ ...plugin, problem: 'disabled' }] },
    { plugins: [{ ...plugin, name: 'other' }] },
    { plugins: [{ ...plugin, version: '2.0.0' }] },
    { plugins: [{ ...plugin, path: '/work/other' }] },
    { plugins: [plugin, { ...plugin, name: 'extra' }] },
    { root: '/work/other' },
    { modelOverride: 'other-model' },
    { ablation: 'with-without' },
    { concurrency: 2 },
  ]) {
    const raw = runnerReport();
    Object.assign(raw.suite, changes);
    const result = normalizeRun(raw, runOptions);
    assert.equal(result.complete, false);
    assert.equal(result.counts.accepted, 0);
    assert.equal(result.counts.ungraded, 2);
    assert.equal(result.costUsd, raw.costUsd);
  }
});

test('classifies an aborted attempt as a runner error despite its full score', () => {
  const result = normalizeRun(runnerReport([{ ...arm(), aborted: true }, arm()]), runOptions);
  assert.equal(result.counts.errors, 1);
  assert.equal(result.counts.accepted, 1);
  assert.equal(result.complete, false);
});

test('checks returned attempts against the repeat override, keeping declared counts for audit', () => {
  const options = { ...runOptions, runs: 3 };
  const reportFor = count => {
    const raw = runnerReport(Array.from({ length: count }, () => arm()));
    raw.cases[0].runsPerCase = 1;
    return raw;
  };
  const complete = normalizeRun(reportFor(3), options);
  assert.equal(complete.complete, true);
  assert.equal(complete.cases[0].declaredRunsPerCase, 1);
  assert.equal(complete.counts.accepted, 3);

  const short = normalizeRun(reportFor(2), options);
  assert.equal(short.complete, false);
  assert.equal(short.counts.missing, 1);
  const extra = normalizeRun(reportFor(4), options);
  assert.equal(extra.complete, false);
  assert.match(extra.issues.join(' '), /attempt layout differs from plan/);
});
