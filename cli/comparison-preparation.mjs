import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { inspectComparison, stageInputs, describeInputs, parseComparisonArgs, inputLabels, budgetAllocation } from './comparison-inputs.mjs';
import { responseRunnerVersion } from './comparison-responses.mjs';
import { renderPreparation } from './comparison-review.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";

function preparationRecord(opts, { inputs, trial, builds }) {
  const settings = {
    model: opts.model, runs: opts.runs, requestedMaxCostUsd: opts.total,
    requiredRunnerVersion: responseRunnerVersion, effort: null,
    effortSource: 'runner default; not exposed by eval', ablation: 'none',
    concurrency: 1, acceptance: 'all deterministic graders pass',
  };
  const tasks = trial.cases.map(({ name, graderNames }) => {
    const root = join(inputs[2], 'cases', name);
    return {
      name, promptMarkdown: readFileSync(join(root, 'prompt.md'), 'utf8'),
      caseYaml: existsSync(join(root, 'case.yaml')) ? readFileSync(join(root, 'case.yaml'), 'utf8') : null,
      graders: graderNames.map(name => ({ name, markdown: readFileSync(join(root, 'graders', `${name}.md`), 'utf8') })),
    };
  });
  const half = budgetAllocation(opts.total);
  return {
    schema: 'buildguild.comparison-preparation.v1', visibility: 'private',
    builds, trial, settings, totalAttempts: trial.cases.length * opts.runs * 2,
    allocatedMaxCostUsd: [half, half], tasks,
  };
}

export function prepareComparison(args, { checkFolder }) {
  const request = inspectComparison(args, checkFolder);
  const { opts, output } = request;
  mkdirSync(output, { mode: 0o700 });
  const oldMask = process.umask(0o077);
  try {
    const staged = stageInputs(request, checkFolder);
    const plan = preparationRecord(opts, staged);
    const bytes = JSON.stringify(plan, null, 2) + '\n';
    const planPath = join(output, 'plan.json');
    const planSha256 = sha256(bytes);
    writeFileSync(planPath, bytes, { mode: 0o600 });
    const executeCommand = [
      'node', fileURLToPath(new URL('./buildguild.mjs', import.meta.url)), 'compare',
      '--plan', planPath, '--plan-sha256', planSha256, '--out', output + '-run',
    ].map(quote).join(' ');
    writeFileSync(join(output, 'review.html'), renderPreparation(plan, { executeCommand, planSha256 }), { mode: 0o600 });
    console.log(`Prepared ${plan.totalAttempts} attempts without calling a model or running fixtures.\nReview: ${join(output, 'review.html')}\nRequested stopping budget $${opts.total}; $${plan.allocatedMaxCostUsd[0]} per build. In-flight overrun is possible.\nActual cost, provider quota and runtime availability have not been checked.\nAfter reviewing, explicitly start with:\n${executeCommand}`);
  } finally { process.umask(oldMask); }
}

// Execute only recognized settings from a reviewed file. A stored command is
// never trusted or run. A file digest binds the prompts, settings and input hashes.
export function loadPreparedComparison(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--plan', '--plan-sha256', '--out'].includes(key) || key in options
      || !args[i + 1] || args[i + 1].startsWith('-'))
      throw Error('Prepared comparison accepts only --plan, --plan-sha256 and --out; settings cannot be overridden.');
    options[key] = args[i + 1];
  }
  if (!options['--plan'] || !options['--out'] || !/^[a-f0-9]{64}$/.test(options['--plan-sha256'] ?? ''))
    throw Error('Use the reviewed command with --plan, --plan-sha256 and a new --out directory.');
  const requested = resolve(options['--plan']);
  if (!lstatSync(requested).isFile()) throw Error('Prepared plan must be a regular file, not a link.');
  const planPath = join(realpathSync(dirname(requested)), basename(requested));
  const bytes = readFileSync(planPath);
  const digest = sha256(bytes);
  if (digest !== options['--plan-sha256']) throw Error('Prepared plan changed; review a new preparation before running.');
  const plan = JSON.parse(bytes);
  if (plan?.schema !== 'buildguild.comparison-preparation.v1' || plan.visibility !== 'private'
    || typeof plan.settings?.model !== 'string' || typeof plan.settings?.runs !== 'number'
    || typeof plan.settings?.requestedMaxCostUsd !== 'number') throw Error('Unsupported or invalid prepared plan.');
  const inputs = inputLabels.map(label => join(dirname(planPath), 'inputs', label));
  for (const input of inputs) if (!lstatSync(input).isDirectory()) throw Error('Prepared inputs must be regular directories.');
  const nextArgs = [inputs[0], inputs[1], '--trial', inputs[2], '--model', plan.settings.model,
    '--runs', String(plan.settings.runs), '--max-cost-usd', String(plan.settings.requestedMaxCostUsd), '--out', options['--out']];
  const opts = parseComparisonArgs(nextArgs);
  const current = preparationRecord(opts, describeInputs(inputs));
  if (!isDeepStrictEqual(plan, current)) throw Error('Prepared inputs or settings differ from the reviewed plan; no evaluation started.');
  return { args: nextArgs, hashes: [...plan.builds, plan.trial].map(item => item.sha256), sha256: digest, path: planPath };
}
