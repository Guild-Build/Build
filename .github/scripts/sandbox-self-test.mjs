// Sandbox self-test for the Season trial job: before the key is fetched or anything is spent, it proves that the agent's
// own Bash tool can start a command through the sandbox on this runner. It runs the trial's own path, the CLI's
// `test` command and through it `claude plugin eval` with the trial's flags, on a one-case trial and an empty build kept
// in .github/sandbox-self-test/, with a stand-in for the model on 127.0.0.1 (stand-in-api.mjs) in place of Anthropic's
// API. The stand-in asks each agent run for one Bash call running PROBE_COMMAND and records what the Bash tool returned.
// The test passes only on positive evidence: the CLI exits 0, every agent run got its result back, and every result is a
// command that exited 0 and printed the three lines below: the arithmetic the shell worked out (so the command really
// ran), seccomp mode 2 (a seccomp filter is on, which the sandbox's helper sets last, after its namespaces), and a user
// namespace other than this runner's own (so the command ran inside the sandbox, not around it).
//
// Usage: node .github/scripts/sandbox-self-test.mjs --model <id>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStandIn, STAND_IN_KEY } from './stand-in-api.mjs';

export const PROBE_COMMAND = `printf 'probe=%s\\n' "$((6 * 7))"; sed -n 's/^Seccomp:[[:space:]]*/seccomp=/p' /proc/self/status; printf 'userns=%s\\n' "$(readlink /proc/self/ns/user)"`;

const show = t => JSON.stringify(t.length > 600 ? `${t.slice(0, 600)}…` : t);

// The verdict on what came back: `runs` is how many agent runs the eval reported, `hostUserns` this runner's own user
// namespace. Pure, so the tests can hold it to every case.
export function judge(results, { runs, hostUserns }) {
  const problems = [];
  if (!Number.isInteger(runs) || runs < 1) problems.push('the eval reported no agent runs, so no shell command was asked for');
  else if (results.length !== runs) problems.push(`${results.length} Bash result(s) came back for ${runs} agent run(s); each run asks for the command once`);
  results.forEach((r, i) => {
    const where = `result ${i + 1}`;
    const lines = r.text.split('\n').map(l => l.trim());
    const value = key => {
      const found = lines.filter(l => l.startsWith(`${key}=`));
      return found.length === 1 ? found[0].slice(key.length + 1) : null;
    };
    if (r.isError || /^Exit code \d+/.test(r.text)) {
      problems.push(`${where}: the command did not exit 0; the Bash tool returned ${show(r.text)}`);
      return;
    }
    if (value('probe') !== '42') problems.push(`${where}: no line probe=42, so the shell did not run the command; the Bash tool returned ${show(r.text)}`);
    if (value('seccomp') !== '2') problems.push(`${where}: no line seccomp=2, so the sandbox's seccomp filter was not on; the Bash tool returned ${show(r.text)}`);
    const ns = value('userns');
    if (!/^user:\[\d+\]$/.test(ns || '')) problems.push(`${where}: no line userns=user:[…]; the Bash tool returned ${show(r.text)}`);
    else if (ns === hostUserns) problems.push(`${where}: the command ran in this runner's own user namespace (${ns}), so not inside the sandbox`);
  });
  return { pass: problems.length === 0, problems };
}

// How many agent runs the raw report lists, over every case and both arms; null when there is no readable report.
export function agentRuns(rawPath) {
  try {
    const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
    return (raw.cases || []).reduce((n, c) => n + (c.arms?.with?.length || 0) + (c.arms?.without?.length || 0), 0);
  } catch {
    return null;
  }
}

// The environment the CLI runs in: this one without any model-provider setting, then pointed at the stand-in with its
// placeholder key, so no request can reach a real provider and no real key is involved.
export function standInEnv(env, port, tmp) {
  const out = Object.fromEntries(Object.entries(env).filter(([k]) => !/^ANTHROPIC_/.test(k) && !/^CLAUDE_CODE_USE_/.test(k)));
  return { ...out, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: STAND_IN_KEY, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', TMPDIR: tmp };
}

async function main() {
  const at = process.argv.indexOf('--model');
  const model = at > 0 ? process.argv[at + 1] : undefined;
  if (!model) { console.error('usage: node .github/scripts/sandbox-self-test.mjs --model <id>'); process.exit(2); }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const base = process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'sandbox-self-test') : mkdtempSync(join(tmpdir(), 'sandbox-self-test-'));
  const tmp = join(base, 'tmp');
  const out = join(base, 'out');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(out, { recursive: true });
  const hostUserns = readlinkSync('/proc/self/ns/user');
  const standIn = await startStandIn({ command: PROBE_COMMAND });
  const rawPath = join(out, 'raw.json');
  const argv = [join(root, 'cli/buildguild.mjs'), 'test', join(root, '.github/sandbox-self-test/empty-build'),
    '--trial', join(root, '.github/sandbox-self-test/trial'), '--model', model, '--max-cost-usd', '0.01', '-j', '1',
    '--runner', 'github-actions', '--role', 'guild', '--out', join(out, 'local-run.json'), '--raw-out', rawPath,
    '--work-dir', join(base, 'run'), '--keep-temp'];
  console.log(`stand-in model API on 127.0.0.1:${standIn.port}; this runner's user namespace is ${hostUserns}`);
  const status = await new Promise(done => {
    const child = spawn(process.execPath, argv, { cwd: root, env: standInEnv(process.env, standIn.port, tmp), stdio: ['ignore', 'inherit', 'inherit'] });
    const timer = setTimeout(() => { console.log('the self-test took over 10 minutes; stopping it'); child.kill('SIGKILL'); }, 10 * 60 * 1000);
    child.on('exit', (code, signal) => { clearTimeout(timer); done(code ?? `signal ${signal}`); });
    child.on('error', e => { clearTimeout(timer); console.log(`could not start the CLI: ${e.message}`); done('not started'); });
  });
  await standIn.close();
  console.log('\nrequests the stand-in answered:');
  for (const r of standIn.requests) console.log(`  ${JSON.stringify(r)}`);
  console.log('\nwhat the Bash tool returned:');
  standIn.results.forEach((r, i) => console.log(`  result ${i + 1}${r.isError ? ' (error)' : ''}: ${show(r.text)}`));
  const verdict = judge(standIn.results, { runs: agentRuns(rawPath), hostUserns });
  if (status !== 0) verdict.problems.unshift(`the CLI ended with exit status ${status}, not 0`);
  if (status !== 0 || !verdict.pass) {
    console.log('\nsandbox self-test FAILED: no proof that the agent\'s shell commands can run inside the sandbox on this runner');
    for (const p of verdict.problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\nsandbox self-test passed: ${standIn.results.length} of ${standIn.results.length} agent runs ran the command inside the sandbox, with exit 0 and the expected output`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
