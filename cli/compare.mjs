// Local-only orchestration. Public season evidence and its submission contract are separate.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { platform, release } from 'node:os';
import { normalizeRun, createComparison, renderComparison } from './comparison-results.mjs';
import { captureResponses, inventoryRunnerTraces, responseRunnerVersion } from './comparison-responses.mjs';

import { inspectComparison, stageInputs, inventory, snapshot, treeHash, inputLabels, budgetAllocation } from './comparison-inputs.mjs';
import { loadPreparedComparison } from './comparison-preparation.mjs';
export { treeHash } from './comparison-inputs.mjs';

const json = p => JSON.parse(readFileSync(p, 'utf8'));
const save = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const quote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";


export async function compare(args, { checkFolder }) {
  const prepared = args.includes('--plan') ? loadPreparedComparison(args) : null;
  const request = inspectComparison(prepared?.args ?? args, checkFolder);
  const { opts, output } = request;
  const v = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000 });
  const runnerVersion = v.status === 0 ? v.stdout.match(/\d+\.\d+\.\d+/)?.[0] : null;
  if (!runnerVersion) throw Error('claude is unavailable; install Claude Code with plugin eval support');
  if (runnerVersion !== responseRunnerVersion) throw Error(`response capture is verified for Claude Code ${responseRunnerVersion}; installed ${runnerVersion}. No evaluation started.`);
  const help = spawnSync('claude', ['plugin', 'eval', '--help'], { encoding: 'utf8', timeout: 15000 });
  for (const option of ['--eval-dir', '--ablation', '--runs', '--max-cost-usd', '--no-publish', '--keep-temp']) if (help.status !== 0 || !help.stdout.includes(option)) throw Error(`installed runner does not advertise ${option}; no evaluation started`);
  inventoryRunnerTraces(); // Check platform and temporary storage before starting.

  mkdirSync(output, { mode: 0o700 }); // exclusive: a racing directory creation fails
  const oldMask = process.umask(0o077);
  try {
    const labels = inputLabels;
    const { inputs, cases, trial, builds } = stageInputs(request, checkFolder);
    if (prepared && [...builds, trial].some((item, i) => item.sha256 !== prepared.hashes[i]))
      throw Error('Reviewed inputs changed during staging; no evaluation started.');
    const settings = { model: opts.model, runs: opts.runs, runnerVersion, responseCapture: 'buildguild.responses.v1', effort: null, effortSource: 'runner default; not exposed by eval', ablation: 'none', concurrency: 1, acceptance: 'all deterministic graders pass', requestedMaxCostUsd: opts.total, os: `${platform()} ${release()}`, node: process.version };
    const rerunArgs = prepared
      ? ['--plan', prepared.path, '--plan-sha256', prepared.sha256, '--out', output + '-rerun']
      : [inputs[0], inputs[1], '--trial', inputs[2], '--model', opts.model, '--max-cost-usd', String(opts.total), '--runs', String(opts.runs), '--out', output + '-rerun'];
    const rerun = ['node', fileURLToPath(new URL('./buildguild.mjs', import.meta.url)), 'compare', ...rerunArgs].map(quote).join(' ');
    const rounds = [];
    const hashes = [...builds.map(b => b.sha256), trial.sha256];
    const inputsMatch = () => { try { return inputs.every((p, i) => treeHash(p) === hashes[i]); } catch { return false; } };
    let inputIssue = null;
    let evidenceIssue = null;
    let previousCost = 0;
    const half = budgetAllocation(opts.total);
    const plan = { schema: 'buildguild.comparison-plan.v1', visibility: 'private', trial, settings, builds, rerun, ...(prepared ? { preparationSha256: prepared.sha256 } : {}) };
    save(join(output, 'plan.json'), plan);
    console.log(`Private comparison in ${output}\nFixtures and hooks execute as you. Local storage does not prevent model-provider processing.\nFinal responses and grader text are retained locally. The runner also retains sealed temporary sandboxes and traces.\nRequested total budget $${opts.total}; an in-flight attempt can exceed its allocation. No public submission.`);
    for (let i = 0; i < 2; i++) {
      const allocation = previousCost === null ? 0 : Math.max(0, Math.min(half, opts.total - previousCost));
      if (!inputsMatch()) inputIssue = 'Saved inputs changed during comparison; results are inconclusive and further runs are skipped.';
      const work = join(output, 'work', labels[i]);
      let evaluatedSha256 = null;
      if (!inputIssue) {
        snapshot(inputs[i], work, inventory(inputs[i]));
        snapshot(join(inputs[2], 'cases'), join(work, 'evals'), inventory(join(inputs[2], 'cases')));
        evaluatedSha256 = treeHash(work);
        if (!inputsMatch()) inputIssue = 'Saved inputs changed during comparison; results are inconclusive and further runs are skipped.';
      }
      const runOutput = join(output, 'runs', labels[i]);
      mkdirSync(runOutput, { recursive: true, mode: 0o700 });
      const rawPath = join(runOutput, 'raw.json');
      let raw = null, exitCode = null, reason = null, traceInventory = null;
      if (inputIssue) {
        reason = inputIssue;
      } else if (allocation < half || allocation <= 0) {
        reason = previousCost === null ? 'Previous spend is unknown; candidate was not started.' : 'Remaining budget cannot fund the same allocation; candidate was not started.';
      } else if (evidenceIssue) {
        reason = 'Previous response capture was incomplete; candidate was not started.';
      } else {
        const argv = ['plugin', 'eval', '.', '--eval-dir', 'evals', '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit', '--json', rawPath, '--no-publish', '--keep-temp', '--trust-plugin', '--ablation', 'none', '--runs', String(opts.runs), '--model', opts.model, '--max-cost-usd', String(allocation), '--threshold', '1', '-j', '1'];
        save(join(runOutput, 'invocation.json'), { executable: 'claude', argv, evaluatedSha256, allocatedMaxCostUsd: allocation });
        traceInventory = inventoryRunnerTraces();
        const proc = spawnSync('claude', argv, { cwd: work, stdio: 'inherit' });
        exitCode = proc.status;
        try { raw = json(rawPath); } catch { reason = 'Runner did not produce a readable raw report.'; }
        if (proc.error || proc.signal) reason = 'Runner was interrupted or could not start.';
      }
      if (!inputsMatch()) inputIssue = 'Saved inputs changed during comparison; results are inconclusive and further runs are skipped.';
      const result = normalizeRun(raw, { cases, runs: opts.runs, exitCode, runnerVersion, model: opts.model, plugin: { ...builds[i].plugin, path: work } });
      result.responseEvidence = captureResponses(raw, { cases, runs: opts.runs, inventory: traceInventory });
      save(join(runOutput, 'responses.json'), result.responseEvidence);
      if (!result.responseEvidence.complete) {
        evidenceIssue = 'Some planned responses were not retained as confirmed final responses.';
        result.issues.push(evidenceIssue);
        result.complete = false;
      }
      if (reason) { result.issues.push(reason); result.complete = false; }
      if (inputIssue) for (const r of [...rounds.map(round => round.result), result]) {
        if (!r.issues.includes(inputIssue)) r.issues.push(inputIssue);
        r.complete = false;
      }
      previousCost = result.costUsd;
      rounds.push({ build: { ...builds[i], evaluatedSha256 }, allocatedMaxCostUsd: allocation, result });
      // Persist an honest incomplete report after the first arm, so interruption preserves useful results.
      const missing = { build: builds[1], allocatedMaxCostUsd: half, result: normalizeRun(null, { cases, runs: opts.runs, exitCode: null, runnerVersion, model: opts.model, plugin: { ...builds[1].plugin, path: join(output, 'work', 'candidate') } }) };
      const report = createComparison({ trial, settings, incumbent: rounds[0], candidate: rounds[1] || missing, rerun });
      save(join(output, 'comparison.json'), report);
      writeFileSync(join(output, 'report.html'), renderComparison(report), { mode: 0o600 });
    }
    const final = json(join(output, 'comparison.json'));
    console.log(`${final.status}: ${join(output, 'report.html')}\nMachine-readable results: ${join(output, 'comparison.json')}`);
    process.exitCode = final.status === 'complete' ? 0 : 2;
  } finally { process.umask(oldMask); }
}
