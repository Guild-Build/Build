// Sandbox self-test for the Season trial job. Before the key is fetched or anything is spent, it proves that the
// agent's own Bash tool can start a command inside the sandbox on this runner. It runs the trial's own path: the CLI's
// `test` command, and through it `claude plugin eval` with the trial's flags, on the one-case trial and the empty build
// in .github/sandbox-self-test/. A stand-in for the model on 127.0.0.1 (stand-in-api.mjs) takes the place of
// Anthropic's API: it asks each agent run for one Bash call running PROBE_COMMAND and records what the Bash tool
// returned. No model is asked and no key is used.
//
// It passes only on positive evidence. The CLI exits 0, and the eval reports exactly the agent runs the self-test's own
// fixture asks for: its one case, run once with the build and once without (expectedRuns). Each of those runs names a
// trace of its own, no trace is named twice, no two run folders share one trace file through a link, and every trace
// found belongs to one of them; each trace is complete by the after-trial check's rule (a) (completeness() in
// shell-starts.mjs) and holds exactly one Bash call, the self-test command, with its result, under an id no other
// request or result repeats. The stand-in received one result for each of those calls, bound by the call's
// id: none missing, none twice, none for a call no trace holds, and each the same as the trace's. Each result is a
// command that exited 0, by Claude Code's own record of it (the rule the after-trial check uses), and printed three
// lines: the arithmetic the shell worked out (so the command really ran), seccomp mode 2 (the sandbox's seccomp helper
// turns its filter on as its last step before the command), and a user namespace other than this runner's own (so the
// command ran inside the sandbox, not beside it). Last, the after-trial check (shell-starts.mjs) accepts the run, so it
// reads this Claude Code release's traces and report in full.
//
// Usage: node .github/scripts/sandbox-self-test.mjs --model <id>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStandIn, STAND_IN_KEY } from './stand-in-api.mjs';
import { bashCalls, completeness, gaps, pairing, readReport, runName, runsIn, sameFiles, tracesIn, verdict } from './shell-starts.mjs';

export const PROBE_COMMAND = `printf 'probe=%s\\n' "$((6 * 7))"; sed -n 's/^Seccomp:[[:space:]]*/seccomp=/p' /proc/self/status; printf 'userns=%s\\n' "$(readlink /proc/self/ns/user)"`;

const show = t => JSON.stringify(t.length > 600 ? `${t.slice(0, 600)}…` : t);
const listed = names => `${names.length} agent run${names.length === 1 ? '' : 's'}${names.length ? ` (${names.join('; ')})` : ''}`;

// The agent runs the self-test's own fixture asks for, sorted: each case its trial lists, as many times as the case's
// prompt.md `runs` says, in each of the two arms the CLI's --ablation with-without runs.
export function expectedRuns(root) {
  const dir = join(root, '.github/sandbox-self-test/trial');
  const trial = JSON.parse(readFileSync(join(dir, 'trial.json'), 'utf8'));
  return trial.cases.flatMap(c => {
    const runs = Number((readFileSync(join(dir, 'cases', c.name, 'prompt.md'), 'utf8').match(/^runs:\s*(\d+)\s*$/m) || [])[1]);
    if (!Number.isInteger(runs) || runs < 1) throw new Error(`cases/${c.name}/prompt.md sets no runs`);
    return ['with', 'without'].flatMap(arm => Array.from({ length: runs }, () => runName(c.name, arm)));
  }).sort();
}

// What is wrong with one Bash result, if anything: it must have exited 0 and printed the three lines, once each.
function probeProblems(r, where, hostUserns) {
  const lines = r.text.split('\n').map(l => l.trim());
  const value = key => {
    const found = lines.filter(l => l.startsWith(`${key}=`));
    return found.length === 1 ? found[0].slice(key.length + 1) : null;
  };
  if (r.isError || /^Exit code -?\d+/.test(r.text)) return [`${where}: the command did not exit 0; the Bash tool returned ${show(r.text)}`];
  const problems = [];
  if (value('probe') !== '42') problems.push(`${where}: no line probe=42, so the shell did not run the command; the Bash tool returned ${show(r.text)}`);
  if (value('seccomp') !== '2') problems.push(`${where}: no line seccomp=2, so the sandbox's seccomp filter was not on; the Bash tool returned ${show(r.text)}`);
  const ns = value('userns');
  if (!/^user:\[\d+\]$/.test(ns || '')) problems.push(`${where}: no line userns=user:[…]; the Bash tool returned ${show(r.text)}`);
  else if (ns === hostUserns) problems.push(`${where}: the command ran in this runner's own user namespace (${ns}), so not inside the sandbox`);
  return problems;
}

// The verdict. `results` is what the stand-in received, `expected` the runs the fixture asks for (expectedRuns), `raw`
// the eval's raw report (null when there is none), `traces` the kept traces by run folder (tracesIn), `linked` the run
// folders that share a trace file through a link (sameFiles), and `hostUserns` this runner's own user namespace. Pure,
// so the tests can hold it to every case.
export function judge(results, { expected, raw, traces, linked = [], hostUserns }) {
  const problems = [];
  const reported = raw ? runsIn(raw) : null;
  if (!reported) problems.push('the eval wrote no readable report, so its agent runs cannot be checked');
  else {
    const names = reported.map(r => r.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) problems.push(`the eval reported ${listed(names)}, but the self-test's trial asks for exactly ${listed(expected)}`);
  }
  // One trace to one run: each reported run names its own, no trace is named twice, and no trace is left over.
  if (reported) {
    const p = pairing(reported, Object.keys(traces));
    if (p.unnamed) problems.push(`${p.unnamed} reported agent run(s) name no trace`);
    if (p.shared.length) problems.push(`${p.shared.length} trace(s) are named by more than one reported agent run: ${p.shared.join(', ')}`);
    if (p.extra.length) problems.push(`${p.extra.length} trace(s) belong to no reported agent run: ${p.extra.join(', ')}`);
  }
  if (linked.length) problems.push(`${linked.length} run folders share their trace file with another through a link: ${linked.join(', ')}`);
  // Each reported run's own trace, read in full, holds exactly one Bash call with its result.
  const traced = new Map();
  const shared = reported ? new Set(pairing(reported, Object.keys(traces)).shared) : new Set();
  for (const run of reported || []) {
    const text = run.trace === null || shared.has(run.trace) ? undefined : traces[run.trace];
    if (typeof text !== 'string') { problems.push(`agent run (${run.name}) left no readable trace of its own`); continue; }
    const missing = gaps(completeness(text));
    if (missing.length) { problems.push(`agent run (${run.name}): its trace is not complete: ${missing.join('; ')}`); continue; }
    const read = bashCalls(text);
    if (read.calls.length !== 1) { problems.push(`agent run (${run.name}): its trace holds ${read.calls.length} Bash call(s) with a result, not exactly one`); continue; }
    if (read.calls[0].command !== PROBE_COMMAND) problems.push(`agent run (${run.name}): its traced Bash call ran ${show(read.calls[0].command)}, not the self-test command`);
    if (traced.has(read.calls[0].id)) problems.push(`agent run (${run.name}): its call id ${read.calls[0].id} is also the call of agent run (${traced.get(read.calls[0].id).run})`);
    traced.set(read.calls[0].id, { run: run.name, ...read.calls[0] });
  }
  // Each traced call's result reached the stand-in exactly once, under its own id and with the same text, and the
  // stand-in received nothing else; then each result must pass on its own.
  const received = new Map();
  for (const r of results) received.set(r.id, [...(received.get(r.id) ?? []), r]);
  for (const [id, copies] of received) {
    if (!traced.has(id)) problems.push(`the stand-in received ${copies.length} result(s) for ${id}, a call no reported run's trace holds`);
    else if (copies.length > 1) problems.push(`the stand-in received ${copies.length} results for ${id}, not one`);
  }
  for (const [id, call] of traced) {
    const copies = received.get(id) ?? [];
    if (!copies.length) { problems.push(`agent run (${call.run}): the stand-in never received the result of its call ${id}`); continue; }
    if (copies.length !== 1) continue;
    const [got] = copies;
    if (got.isError !== call.isError || got.text.trim() !== call.text.trim()) problems.push(`agent run (${call.run}): the result the stand-in received for ${id} differs from the one its trace holds`);
    problems.push(...probeProblems(got, `agent run (${call.run})`, hostUserns));
    // The exit 0 by Claude Code's own record, as rule (d) of the after-trial check reads it.
    if (!got.isError && !call.exitedZero) problems.push(`agent run (${call.run}): Claude Code's own record of the result does not show an exit 0 (it holds no record, or one of an interrupted command, an exit status 1 read as success or a command run in the background)`);
  }
  const after = verdict(traces, raw, linked);
  if (!after.measurement) problems.push(`the after-trial check would not accept this run: ${after.sentence}`);
  return { pass: problems.length === 0, problems };
}

// The environment the CLI runs in: this one without any model-provider setting, then pointed at the stand-in with its
// placeholder key, so no request can reach a real provider and no real key is involved.
export function standInEnv(env, port, tmp) {
  const kept = Object.fromEntries(Object.entries(env).filter(([k]) => !/^ANTHROPIC_/.test(k) && !/^CLAUDE_CODE_USE_/.test(k)));
  return { ...kept, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: STAND_IN_KEY, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', TMPDIR: tmp };
}

// The CLI's arguments: the trial job's run step's flags, on the self-test's build and trial. The ceiling only guards
// against a mistake, since the stand-in charges nothing.
export function cliArgs({ root, model, base }) {
  return [join(root, 'cli/buildguild.mjs'), 'test', join(root, '.github/sandbox-self-test/empty-build'),
    '--trial', join(root, '.github/sandbox-self-test/trial'), '--max-cost-usd', '0.01', '--model', model, '-j', '1',
    '--runner', 'github-actions', '--role', 'guild', '--out', join(base, 'out', 'local-run.json'),
    '--raw-out', join(base, 'out', 'raw.json'), '--work-dir', join(base, 'run'), '--keep-temp'];
}

// One self-test run in `base`: the stand-in, the CLI under it, and the verdict. `env` is the environment to start from.
export async function selfTest({ root, model, base, env, hostUserns, timeoutMs = 10 * 60 * 1000, log = console.log, stdio = 'inherit' }) {
  const tmp = join(base, 'tmp');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(join(base, 'out'), { recursive: true });
  const standIn = await startStandIn({ command: PROBE_COMMAND });
  log(`stand-in model API on 127.0.0.1:${standIn.port}; this runner's user namespace is ${hostUserns}`);
  const status = await new Promise(done => {
    const child = spawn(process.execPath, cliArgs({ root, model, base }), { cwd: root, env: standInEnv(env, standIn.port, tmp), stdio: ['ignore', stdio, stdio] });
    const timer = setTimeout(() => { log('the self-test took too long; stopping it'); child.kill('SIGKILL'); }, timeoutMs);
    child.on('exit', (code, signal) => { clearTimeout(timer); done(code ?? `signal ${signal}`); });
    child.on('error', e => { clearTimeout(timer); log(`could not start the CLI: ${e.message}`); done('not started'); });
  });
  await standIn.close();
  const traces = tracesIn(tmp);
  const outcome = judge(standIn.results, { expected: expectedRuns(root), raw: readReport(join(base, 'out', 'raw.json')), traces, linked: sameFiles(tmp, Object.keys(traces)), hostUserns });
  if (status !== 0) {
    outcome.problems.unshift(`the CLI ended with exit status ${status}, not 0`);
    outcome.pass = false;
  }
  return { status, results: standIn.results, requests: standIn.requests, verdict: outcome };
}

async function main() {
  const at = process.argv.indexOf('--model');
  const model = at > 0 ? process.argv[at + 1] : undefined;
  if (!model) { console.error('usage: node .github/scripts/sandbox-self-test.mjs --model <id>'); process.exit(2); }
  let hostUserns;
  try { hostUserns = readlinkSync('/proc/self/ns/user'); } catch {
    console.log('sandbox self-test FAILED: this runner has no /proc/self/ns/user, so it cannot tell inside the sandbox from outside it');
    process.exit(1);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const base = process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'sandbox-self-test') : mkdtempSync(join(tmpdir(), 'sandbox-self-test-'));
  const run = await selfTest({ root, model, base, env: process.env, hostUserns });
  console.log('\nrequests the stand-in answered:');
  for (const r of run.requests) console.log(`  ${JSON.stringify(r)}`);
  console.log('\nwhat the Bash tool returned:');
  run.results.forEach((r, i) => console.log(`  result ${i + 1}${r.isError ? ' (error)' : ''}: ${show(r.text)}`));
  if (!run.verdict.pass) {
    console.log('\nsandbox self-test FAILED: no proof that an agent\'s shell commands can run inside the sandbox on this runner, so no trial runs');
    for (const p of run.verdict.problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  const expected = expectedRuns(root);
  console.log(`\nsandbox self-test passed: each of the ${expected.length} agent runs the self-test asks for (${expected.join('; ')}) ran the command inside the sandbox, with exit 0 and the expected output, and the after-trial check accepts the run`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
