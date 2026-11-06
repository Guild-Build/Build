// Local-only orchestration. Public season evidence and its submission contract are separate.
import { readFileSync, writeFileSync, readdirSync, lstatSync, statSync, realpathSync, mkdirSync, chmodSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { platform, release } from 'node:os';
import { normalizeRun, createComparison, renderComparison } from './comparison-results.mjs';

const inside = (a, b) => a === b || a.startsWith(b + sep);
const overlap = (a, b) => inside(a, b) || inside(b, a);
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const save = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const quote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";

function parseArgs(args) {
  const options = {}, paths = [];
  const allowed = new Set(['trial', 'model', 'max-cost-usd', 'out', 'runs']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) { paths.push(arg); continue; }
    const key = arg.slice(2);
    if (!arg.startsWith('--') || !allowed.has(key)) throw Error(`unsupported compare option: ${arg}`);
    if (key in options || !args[i + 1] || args[i + 1].startsWith('-')) throw Error(`${arg} needs exactly one value`);
    options[key] = args[++i];
  }
  if (paths.length !== 2) throw Error('compare needs the current and candidate build folders');
  for (const key of ['trial', 'model', 'max-cost-usd', 'out']) if (!options[key]) throw Error(`compare requires --${key}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._\[\]-]*$/.test(options.model)) throw Error('--model must be an explicit model id');
  if (!/^\d+(\.\d+)?$/.test(options['max-cost-usd']) || !Number.isFinite(Number(options['max-cost-usd'])) || Number(options['max-cost-usd']) < 0.000002) throw Error('--max-cost-usd must be a positive total of at least 0.000002 USD');
  const runs = options.runs ?? '3';
  if (!/^[1-9]\d*$/.test(runs) || !Number.isSafeInteger(Number(runs)) || Number(runs) > 100) throw Error('--runs must be a whole number from 1 to 100');
  return { ...options, runs: Number(runs), total: Number(options['max-cost-usd']), paths };
}

// Reject links before reading content. A local comparison never imports a repository's .git or old eval output.
function inventory(root, build = false, prefix = '', excludeGit = false) {
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    if (!prefix && ((excludeGit && name === '.git') || (build && name === 'evals'))) return [];
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = lstatSync(join(root, rel));
    if (st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) throw Error(`only regular files and directories are allowed: ${rel}`);
    if (['.env', '.env.local', 'credentials.json', 'id_rsa', 'id_ed25519'].includes(name)) throw Error(`remove credential file from comparison input: ${rel}`);
    if (st.isDirectory()) return inventory(root, build, rel, excludeGit);
    return { rel, mode: st.mode & 0o111 ? 0o755 : 0o644 };
  });
}

function snapshot(source, dest, files) {
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const { rel, mode } of files) {
    // Recheck against links changed after inventory.
    const src = join(source, rel);
    if (!inside(realpathSync(src), source) || !lstatSync(src).isFile()) throw Error(`input changed during snapshot: ${rel}`);
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(src, target);
    chmodSync(target, mode);
  }
}

export function treeHash(root) {
  const h = createHash('sha256');
  for (const { rel, mode } of inventory(root)) {
    const bytes = readFileSync(join(root, rel));
    h.update(JSON.stringify([rel, mode, bytes.length]) + '\n');
    h.update(bytes);
  }
  return h.digest('hex');
}

function deterministicCases(root, trial) {
  if (!Array.isArray(trial.cases) || trial.cases.length === 0) throw Error('trial needs cases');
  const seen = new Set();
  return trial.cases.map(c => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name) || seen.has(c.name)) throw Error('trial case names must be unique kebab-case names');
    seen.add(c.name);
    if (c.acceptanceThreshold !== undefined && c.acceptanceThreshold !== 1) throw Error('compare requires all deterministic graders to pass (acceptanceThreshold 1)');
    const caseDir = join(root, 'cases', c.name);
    const yamlPath = join(caseDir, 'case.yaml');
    if (existsSync(yamlPath)) {
      const yaml = readFileSync(yamlPath, 'utf8');
      const fixture = yaml.match(/scaffold_script:\s*(\S+)/)?.[1];
      if (fixture && (!/^[a-zA-Z0-9_./-]+$/.test(fixture) || !inside(resolve(caseDir, fixture), caseDir))) throw Error(`${c.name}: fixture must be inside its case folder`);
    }
    const graders = readdirSync(join(caseDir, 'graders')).filter(n => n.endsWith('.md')).sort().map(name => {
      const src = readFileSync(join(caseDir, 'graders', name), 'utf8');
      const type = src.match(/^type:\s*(\S+)\s*$/m)?.[1];
      if (!['regex', 'file_exists', 'tool_used'].includes(type)) throw Error(`${c.name}/${name}: compare supports deterministic regex, file_exists and tool_used graders only`);
      return name.slice(0, -3);
    });
    if (!graders.length) throw Error(`${c.name}: no graders`);
    return { name: c.name, dimension: c.dimension, acceptanceThreshold: 1, graderNames: graders };
  });
}

export async function compare(args, { checkFolder }) {
  const opts = parseArgs(args);
  const sources = [...opts.paths, opts.trial].map(p => {
    if (lstatSync(resolve(p)).isSymbolicLink()) throw Error('input folder cannot be a symlink');
    const real = realpathSync(p);
    if (!statSync(real).isDirectory()) throw Error(`not a folder: ${p}`);
    return real;
  });
  const requested = resolve(opts.out);
  // Parent must exist: canonicalize it to prevent aliases into either source tree.
  const output = join(realpathSync(dirname(requested)), requested.slice(dirname(requested).length + 1));
  if (sources.some(p => overlap(output, p))) throw Error('--out must be outside every input folder and cannot contain an input');
  if (existsSync(output)) throw Error('--out must be a new directory; nothing was overwritten');
  const files = sources.map((root, i) => inventory(root, i < 2, '', true));
  const trialInput = json(join(sources[2], 'trial.json'));
  deterministicCases(sources[2], trialInput);
  // No fixture or plugin code is executed in preflight.
  for (let i = 0; i < 3; i++) checkFolder(sources[i], i === 2 ? 'trial' : 'build', { structuralOnly: true, ignoreEvals: true });
  const v = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000 });
  const runnerVersion = v.status === 0 ? v.stdout.match(/\d+\.\d+\.\d+/)?.[0] : null;
  if (!runnerVersion) throw Error('claude is unavailable; install Claude Code with plugin eval support');
  const help = spawnSync('claude', ['plugin', 'eval', '--help'], { encoding: 'utf8', timeout: 15000 });
  for (const option of ['--eval-dir', '--ablation', '--runs', '--max-cost-usd', '--no-publish']) if (help.status !== 0 || !help.stdout.includes(option)) throw Error(`installed runner does not advertise ${option}; no evaluation started`);

  mkdirSync(output, { mode: 0o700 }); // exclusive: a racing directory creation fails
  const oldMask = process.umask(0o077);
  try {
    const labels = ['incumbent', 'candidate', 'trial'];
    const inputs = labels.map(label => join(output, 'inputs', label));
    sources.forEach((source, i) => snapshot(source, inputs[i], files[i]));
    for (let i = 0; i < 3; i++) checkFolder(inputs[i], i === 2 ? 'trial' : 'build', { structuralOnly: true, ignoreEvals: true });
    const trialRecord = json(join(inputs[2], 'trial.json'));
    const cases = deterministicCases(inputs[2], trialRecord);
    const trial = { slug: trialRecord.slug, version: trialRecord.version, sha256: treeHash(inputs[2]), cases };
    const settings = { model: opts.model, runs: opts.runs, runnerVersion, effort: null, effortSource: 'runner default; not exposed by eval', ablation: 'none', concurrency: 1, acceptance: 'all deterministic graders pass', requestedMaxCostUsd: opts.total, os: `${platform()} ${release()}`, node: process.version };
    const builds = inputs.slice(0, 2).map(p => { const manifest = json(join(p, 'buildguild.json')); return { slug: manifest.slug, version: manifest.version, sha256: treeHash(p) }; });
    const rerun = ['node', fileURLToPath(new URL('./buildguild.mjs', import.meta.url)), 'compare', inputs[0], inputs[1], '--trial', inputs[2], '--model', opts.model, '--max-cost-usd', String(opts.total), '--runs', String(opts.runs), '--out', output + '-rerun'].map(quote).join(' ');
    const rounds = [];
    const hashes = [...builds.map(b => b.sha256), trial.sha256];
    const inputsMatch = () => { try { return inputs.every((p, i) => treeHash(p) === hashes[i]); } catch { return false; } };
    let inputIssue = null;
    let previousCost = 0;
    const half = Math.floor(opts.total * 500000) / 1000000;
    const plan = { schema: 'buildguild.comparison-plan.v1', visibility: 'private', trial, settings, builds, rerun };
    save(join(output, 'plan.json'), plan);
    console.log(`Private comparison in ${output}\nFixtures and hooks execute as you. Local storage does not prevent model-provider processing.\nRequested total budget $${opts.total}; an in-flight attempt can exceed its allocation. No public submission.`);
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
      let raw = null, exitCode = null, reason = null;
      if (inputIssue) {
        reason = inputIssue;
      } else if (allocation < half || allocation <= 0) {
        reason = previousCost === null ? 'Previous spend is unknown; candidate was not started.' : 'Remaining budget cannot fund the same allocation; candidate was not started.';
      } else {
        const argv = ['plugin', 'eval', '.', '--eval-dir', 'evals', '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit', '--json', rawPath, '--no-publish', '--trust-plugin', '--ablation', 'none', '--runs', String(opts.runs), '--model', opts.model, '--max-cost-usd', String(allocation), '--threshold', '1', '-j', '1'];
        save(join(runOutput, 'invocation.json'), { executable: 'claude', argv, evaluatedSha256, allocatedMaxCostUsd: allocation });
        const proc = spawnSync('claude', argv, { cwd: work, stdio: 'inherit' });
        exitCode = proc.status;
        try { raw = json(rawPath); } catch { reason = 'Runner did not produce a readable raw report.'; }
        if (proc.error || proc.signal) reason = 'Runner was interrupted or could not start.';
      }
      if (!inputsMatch()) inputIssue = 'Saved inputs changed during comparison; results are inconclusive and further runs are skipped.';
      const result = normalizeRun(raw, { cases, runs: opts.runs, exitCode, runnerVersion });
      if (reason) { result.issues.push(reason); result.complete = false; }
      if (inputIssue) for (const r of [...rounds.map(round => round.result), result]) {
        if (!r.issues.includes(inputIssue)) r.issues.push(inputIssue);
        r.complete = false;
      }
      previousCost = result.costUsd;
      rounds.push({ build: { ...builds[i], evaluatedSha256 }, allocatedMaxCostUsd: allocation, result });
      // Persist an honest incomplete report after the first arm, so interruption preserves useful results.
      const missing = { build: builds[1], allocatedMaxCostUsd: half, result: normalizeRun(null, { cases, runs: opts.runs, exitCode: null, runnerVersion }) };
      const report = createComparison({ trial, settings, incumbent: rounds[0], candidate: rounds[1] || missing, rerun });
      save(join(output, 'comparison.json'), report);
      writeFileSync(join(output, 'report.html'), renderComparison(report), { mode: 0o600 });
    }
    const final = json(join(output, 'comparison.json'));
    console.log(`${final.status}: ${join(output, 'report.html')}\nMachine-readable results: ${join(output, 'comparison.json')}`);
    process.exitCode = final.status === 'complete' ? 0 : 2;
  } finally { process.umask(oldMask); }
}
