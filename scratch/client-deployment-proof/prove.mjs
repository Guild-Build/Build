// Proves the Client Deployment Trial's fixtures inside Claude Code's sandbox, through the trial's own path: the CLI's
// test command and, through it, claude plugin eval with the trial's flags, on the empty build of the sandbox self-test.
// A scripted stand-in for the model on 127.0.0.1 plays each case's session (sessions.mjs), so no model is asked and
// nothing is spent. It then reads the eval's raw report for every grader of every agent run, and runs the after-trial
// check (shell-starts.mjs) on the traces. Scratch only.
//
// Usage: node scratch/client-deployment-proof/prove.mjs --mode reference|nothing|no-attempt|diagnose --out <dir> [--cases a,b]
// Modes: reference expects every grader to pass in both arms; nothing expects every agent run to miss at least one;
// no-attempt is the reference of stop-when-blocked without a deploy attempt; diagnose only reports.
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standInEnv } from '../../.github/scripts/sandbox-self-test.mjs';
import { readReport, sameFiles, tracesIn, verdict } from '../../.github/scripts/shell-starts.mjs';
import { sessionsFor } from './sessions.mjs';
import { startScriptedStandIn } from './stand-in.mjs';

const arg = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : undefined; };
const mode = arg('mode');
const out = resolve(arg('out') || 'proof-out');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = 'client-deployment-v1';
const record = JSON.parse(readFileSync(join(root, 'content/trials', `${slug}.json`), 'utf8'));
const casesDir = join(root, 'content/trials', slug, 'cases');
const names = arg('cases') ? arg('cases').split(',') : record.cases.map(c => c.name);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'tmp'), { recursive: true });
// The trial laid out as a trial folder, as the repository's own test does for buildguild check.
const trialDir = join(out, 'trial');
mkdirSync(join(trialDir, 'cases'), { recursive: true });
writeFileSync(join(trialDir, 'trial.json'), JSON.stringify({ ...record, cases: record.cases.filter(c => names.includes(c.name)) }, null, 2) + '\n');
writeFileSync(join(trialDir, 'README.md'), `# ${record.name}\n\n${record.summary}\n\nLaid out as a trial folder for a scratch proof run on a free runner; a run on it is not evidence.\n`);
copyFileSync(join(root, 'LICENSE'), join(trialDir, 'LICENSE'));
for (const name of names) cpSync(join(casesDir, name), join(trialDir, 'cases', name), { recursive: true });

const standIn = await startScriptedStandIn({ sessions: sessionsFor(mode, casesDir, names), tag: mode.replace(/\W/g, '') });
console.log(`stand-in on 127.0.0.1:${standIn.port}, mode ${mode}, cases ${names.join(', ')}`);
const cli = [join(root, 'cli/buildguild.mjs'), 'test', join(root, '.github/sandbox-self-test/empty-build'), '--trial', trialDir,
  '--max-cost-usd', '1', '--model', 'claude-sonnet-5-5', '-j', '1', '--runner', 'github-actions', '--role', 'guild',
  '--out', join(out, 'local-run.json'), '--raw-out', join(out, 'raw.json'), '--work-dir', join(out, 'run'), '--keep-temp'];
const status = await new Promise(done => {
  const child = spawn(process.execPath, cli, { cwd: root, env: standInEnv(process.env, standIn.port, join(out, 'tmp')), stdio: ['ignore', 'inherit', 'inherit'] });
  const timer = setTimeout(() => { console.log('took too long; stopping'); child.kill('SIGKILL'); }, 40 * 60 * 1000);
  child.on('exit', (code, signal) => { clearTimeout(timer); done(code ?? `signal ${signal}`); });
});
await standIn.close();
writeFileSync(join(out, 'stand-in.json'), JSON.stringify(standIn.log, null, 2) + '\n');

// Every agent run's graders, from the eval's own raw report.
const raw = readReport(join(out, 'raw.json'));
const rows = [];
const problems = [];
if (status !== 0) problems.push(`the CLI ended with exit status ${status}`);
if (!raw) problems.push('the eval wrote no readable raw report');
for (const c of raw?.cases || []) {
  for (const arm of ['with', 'without']) {
    for (const run of c.arms?.[arm] || []) {
      const failed = (run.graders || []).filter(g => g.scored !== false && !g.passed);
      const cwd = run.tracePath ? join(dirname(dirname(run.tracePath)), 'home', 'cwd') : null;
      rows.push({ case: c.name, arm, score: run.score, error: run.error, passed: (run.graders || []).filter(g => g.passed).length,
        graders: (run.graders || []).length, failed: failed.map(g => `${g.name} (${g.weight}): ${g.explanation}`), trace: run.tracePath, cwd });
    }
  }
}
for (const name of names) {
  for (const arm of ['with', 'without']) if (!rows.some(r => r.case === name && r.arm === arm)) problems.push(`${name} (${arm}): no agent run in the report`);
}
// What the stand-in played: each case's conversations must reach the scripted reply, once per arm.
const finals = standIn.log.filter(l => l.step === 'final');
for (const name of names) {
  const n = finals.filter(l => l.case === name).length;
  if (n !== 2) problems.push(`${name}: the stand-in sent its scripted reply ${n} time(s), not once per arm`);
}
for (const r of rows) {
  if (r.error) problems.push(`${r.case} (${r.arm}): the agent run ended in an error: ${r.error}`);
  if (mode === 'reference' || mode === 'no-attempt') { if (r.score !== 1 || r.failed.length) problems.push(`${r.case} (${r.arm}): score ${r.score}, failed ${r.failed.join('; ')}`); }
  if (mode === 'nothing') { if (!(r.score < 1) || !r.failed.length) problems.push(`${r.case} (${r.arm}): a do-nothing reply scored ${r.score}`); }
}
// The after-trial check of the trial job, on this run's traces and report.
const traces = tracesIn(join(out, 'tmp'));
const after = verdict(traces, raw, sameFiles(join(out, 'tmp'), Object.keys(traces)));
if (!after.measurement) problems.push(`the after-trial check would not call this a measurement: ${after.sentence}`);

// The final working folder of each run, as the graders saw it (outside the sandbox).
const listing = {};
for (const r of rows) {
  if (!r.cwd || !existsSync(r.cwd)) continue;
  const files = {};
  for (const sub of ['out', '.audit', '.preflight']) {
    const d = join(r.cwd, sub);
    if (existsSync(d)) for (const f of readdirSync(d)) files[`${sub}/${f}`] = readFileSync(join(d, f), 'utf8').slice(0, 2000);
  }
  listing[`${r.case} (${r.arm})`] = { entries: readdirSync(r.cwd).sort(), files };
}

const pct = s => (typeof s === 'number' ? s.toFixed(3) : String(s));
const md = [`### ${mode}: ${problems.length ? 'FAILED' : 'as expected'}`, '',
  `CLI exit ${status}; ${rows.length} agent runs; after-trial check: ${after.measurement ? 'a measurement' : 'NOT a measurement'} (${after.sentence})`, '',
  '| Case | Arm | Score | Graders passed | Failed graders |', '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.case} | ${r.arm} | ${pct(r.score)} | ${r.passed} of ${r.graders} | ${r.failed.map(f => f.split(':')[0]).join(', ') || 'none'} |`), ''];
if (problems.length) md.push('Problems:', ...problems.map(p => `- ${p}`), '');
writeFileSync(join(out, 'summary.json'), JSON.stringify({ mode, status, measurement: after.measurement, afterTrial: after.sentence, rows, problems, listing }, null, 2) + '\n');
writeFileSync(join(out, 'summary.md'), md.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
console.log(md.join('\n'));
// Each conversation's tool results, for reading what ran (diagnostics included).
for (const f of finals) {
  console.log(`\n===== ${f.case}: tool results =====`);
  f.results.forEach((r, i) => console.log(`--- step ${i + 1}${r.isError ? ' (error)' : ''}\n${r.text}`));
}
if (mode !== 'diagnose' && problems.length) process.exit(1);
