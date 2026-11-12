// The Season trial job's two sandbox checks and the pins behind them. Before the key is fetched, the self-test
// (.github/scripts/sandbox-self-test.mjs) runs the trial's own path with a stand-in for the model
// (.github/scripts/stand-in-api.mjs); after the trial, .github/scripts/shell-starts.mjs decides whether the traces show
// that the sandbox started every shell command Claude Code tried to run. Nothing here calls a model or the network: the
// stand-in and every claude are local, and no test runs git.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { decide, startStandIn, STAND_IN_KEY } from '../.github/scripts/stand-in-api.mjs';
import { cliArgs, expectedRuns, judge, PROBE_COMMAND, selfTest, standInEnv } from '../.github/scripts/sandbox-self-test.mjs';
import { ALLOWED_REFUSALS, bashCalls, kindOf, runsIn, SETUP_LINES, tracesIn, verdict } from '../.github/scripts/shell-starts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => readFileSync(join(root, rel), 'utf8');
const workflow = read('.github/workflows/trial.yml');
const check = read('.github/workflows/sandbox.yml');
const install = read('.github/scripts/install-trial-tools.sh');
const readme = read('README.md');
const temp = (t, prefix) => { const dir = mkdtempSync(join(tmpdir(), prefix)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

// Bash results as Claude Code 2.1.322 wrote them, sandbox on, when a stand-in model asked for each call (runs
// 43266336234 and 43271503569): [is_error, content, its tool_result_meta entry, its tool_use_result record where that
// matters]. Those under BROKEN came from ubuntu-26.04, where the sandbox cannot start a command.
const ACCEPT = { permission_decision: { decision: 'accept', source: 'config', reason_type: 'rule' } };
const RECORD = (stdout, more = {}) => ({ stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...more });
const HOOK = { non_execution_kind: 'permission-rule', permission_decision: { decision: 'reject', source: 'hook', reason_type: 'hook' } };
const SECCOMP_HELPER = 'apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied';
const OBSERVED = {
  'exit 0': [false, 'hi', ACCEPT, RECORD('hi')],
  'exit 3': [true, 'Exit code 3\nout\nerr', ACCEPT, 'Error: Exit code 3\nout\nerr'],
  'grep miss': [false, '(Bash completed with no output)', ACCEPT, RECORD('', { returnCodeInterpretation: 'No matches found' })],
  'git diff, files differ': [false, '(Bash completed with no output)', ACCEPT, RECORD('', { returnCodeInterpretation: 'Files differ' })],
  'started in the background': [false, 'Command running in background with ID: b5gv2xnhr. Output is being written to: /tmp/claude-1001/-home-runner-work--temp-scenarios-scn-kmAPHv-cwd/ecb0498e-8c52-43e7-9993-96ccf8633c46/tasks/b5gv2xnhr.output. You will be notified when it completes. To check interim output, use Read on that file path.', ACCEPT, RECORD('', { backgroundTaskId: 'b5gv2xnhr' })],
  'runs past its timeout': [false, 'Command did not complete within its 2s timeout and was moved to the background (ID: b4pj2kv63). Output is being written to: /tmp/claude-1001/-home-runner-work--temp-scenarios-scn-QDL2NE-cwd/2960bd1c-c417-4d20-a6b5-d3860061a14b/tasks/b4pj2kv63.output. You will be notified when it completes.', ACCEPT, RECORD('', { backgroundTaskId: 'b4pj2kv63', timedOutAfterMs: 2000 })],
  'hook exits 2': [true, "PreToolUse:Bash hook error: [echo 'test hook: blocked' >&2; exit 2]: test hook: blocked\n", HOOK],
  'hook denies by JSON': [true, 'PreToolUse:Bash hook error: json hook says no', HOOK],
  'malformed input': [true, '<tool_use_error>InputValidationError: Bash failed due to the following issues:\nThe required parameter `command` is missing\nAn unexpected parameter `cmd` was provided</tool_use_error>', undefined],
  'long sleep': [true, '<tool_use_error>Blocked: standalone sleep 120. To wait for a condition, use Monitor with an until-loop (e.g. `until <check>; do sleep 2; done`). To wait for a command you started, use run_in_background: true. Do not chain shorter sleeps to work around this block.</tool_use_error>', undefined],
};
const BROKEN = {
  'exit 0, sandbox broken': [true, `Exit code 1\n${SECCOMP_HELPER}`, ACCEPT],
  'grep miss, sandbox broken': [false, SECCOMP_HELPER, ACCEPT, RECORD(SECCOMP_HELPER, { returnCodeInterpretation: 'No matches found' })],
};
// What the pilot run's Bash tool returned for each of its 30 shell calls (run 43153585543), and results this release's
// source writes but which a free run cannot produce: its sandbox bridge error, its refusals of a command for a sandbox
// reason, and a command interrupted before it finished.
const bashrc = folder => `/bin/bash: /home/runner/work/_temp/evaltmp/${folder}/home/.bashrc: Permission denied`;
const BASHRC = bashrc('claude-eval-1dVSyj');
const PILOT = `Exit code 1\n${BASHRC}\n${BASHRC}\n${SECCOMP_HELPER}`;
const FROM_SOURCE = [
  'Linux sandbox HTTP bridge socket is missing (socat may have died). Restart to retry.',
  'Linux sandbox SOCKS bridge socket is missing (socat may have died). Restart to retry.',
  'Sandbox is required (sandbox.failIfUnavailable) and stopped being available in this session: socat is no longer installed. The command was refused, and so is a request to run it outside the sandbox (dangerouslyDisableSandbox): do not retry it that way. Only commands the user runs themselves with the `!` prefix, and commands their settings exclude from the sandbox, still run.',
  'Sandbox is required but failed to initialize: bwrap is missing. Restart to retry. Running it outside the sandbox (dangerouslyDisableSandbox) is not allowed either.',
  'Sandbox is enabled but failed to initialize. Sandboxing is disabled for the rest of this session; restart to retry.',
  'partial output\n<error>Command was aborted before completion</error>',
];
const working = folder => `${bashrc(folder)}\n${bashrc(folder)}\nprobe=42\nseccomp=2\nuserns=user:[4026532282]`;
const HOST = 'user:[4026531837]';

// A trace as Claude Code writes it, one JSON message per line. Each call is [tool, input, isError, text, meta, record]:
// a call whose text is undefined has no result, meta is its tool_result_meta entry and record its tool_use_result. Ids
// start with `prefix`.
const entries = (calls, prefix = 'toolu') => calls.flatMap(([tool, input, isError, text, meta, record], i) => [
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `${prefix}_${i}`, name: tool, input }] } },
  ...(text === undefined ? [] : [{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${prefix}_${i}`, content: text, ...(isError ? { is_error: true } : {}) }] }, ...(meta ? { tool_result_meta: [{ id: `${prefix}_${i}`, ...meta }] } : {}), ...(record === undefined ? {} : { tool_use_result: record }) }]),
]);
const trace = (calls, prefix) => entries(calls, prefix).map(entry => JSON.stringify(entry)).join('\n') + '\n';
// A Bash call with the record Claude Code writes beside a command's own exit: its error text, or what it printed.
const bash = (command, isError, text, meta = ACCEPT, record = isError ? `Error: ${text}` : RECORD(text)) => ['Bash', { command }, isError, text, meta, record];
const shape = ([isError, text, meta, record], command = 'c') => ['Bash', { command }, isError, text, meta, record];
// A raw report as the eval writes it: each run is [case, arm, run folder], with the trace path the eval gives it.
const report = runs => {
  const cases = new Map();
  for (const [name, arm, folder] of runs) {
    if (!cases.has(name)) cases.set(name, { name, arms: { with: [], without: [] } });
    cases.get(name).arms[arm].push({ score: 1, error: null, tracePath: folder === null ? null : `/home/runner/work/_temp/evaltmp/${folder}/out/trace.jsonl` });
  }
  return { cases: [...cases.values()] };
};
// A run whose traces and report agree, from { folder: [calls] }, each run in its own case.
const run = byFolder => ({ traces: Object.fromEntries(Object.entries(byFolder).map(([f, calls]) => [f, trace(calls, f)])), raw: report(Object.keys(byFolder).map(f => [`case-${f}`, 'with', f])) });
const verdictOf = byFolder => { const r = run(byFolder); return verdict(r.traces, r.raw); };

// A step of the trial job as written, and its run lines as its shell sees them.
const stepText = name => {
  const start = workflow.indexOf(`\n      - name: ${name}\n`);
  assert.ok(start >= 0, `no step named ${name}`);
  const end = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start + 1, end < 0 ? undefined : end + 1);
};
const runLines = name => {
  const text = stepText(name);
  const body = text.slice(text.indexOf('        run: |\n') + '        run: |\n'.length);
  return body.split('\n').map(line => line.slice(10)).join('\n');
};
const INSTALL = 'Install Claude Code and the Linux sandbox backend it needs for Bash-granting runs';
const SELF_TEST = "Self-test the sandbox through the agent's own Bash tool, before any key or spend";
const SHELLS = "Check that the sandbox started the agents' shell commands";
const GATHER = 'Gather the files to upload';

test('the stand-in asks for one Bash call, records what came back once, and otherwise only closes', () => {
  const seen = new Set();
  let n = 0;
  const as = body => decide(body, { command: 'echo hi', seen, nextId: () => ++n });
  const offer = { tools: [{ name: 'Read' }, { name: 'Bash' }], messages: [{ role: 'user', content: 'Run it.' }] };
  const first = as(offer);
  assert.equal(first.reply.stop_reason, 'tool_use');
  assert.deepEqual(first.reply.content, [{ type: 'tool_use', id: 'toolu_sandbox_self_test_1', name: 'Bash', input: { command: 'echo hi', description: 'Sandbox self-test command' } }]);
  assert.deepEqual(first.results, []);
  // A request without the Bash tool, such as a side request, gets a plain reply and no call.
  assert.deepEqual(as({ messages: [{ role: 'user', content: 'A title?' }] }), { reply: { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }, results: [] });
  // A result for some other call is not the stand-in's: it is not recorded.
  assert.deepEqual(as({ ...offer, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_other', content: 'x' }] }] }).results, []);
  // The call's result comes back, here as text blocks: recorded once, and every later turn only closes.
  const back = { ...offer, messages: [...offer.messages, { role: 'assistant', content: first.reply.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sandbox_self_test_1', content: [{ type: 'text', text: 'hi' }], is_error: true }] }] };
  const second = as(back);
  assert.equal(second.reply.stop_reason, 'end_turn');
  assert.deepEqual(second.results, [{ id: 'toolu_sandbox_self_test_1', isError: true, text: 'hi' }]);
  seen.add('toolu_sandbox_self_test_1');
  const later = as({ ...back, messages: [...back.messages, { role: 'assistant', content: second.reply.content }, { role: 'user', content: 'And now?' }] });
  assert.equal(later.reply.stop_reason, 'end_turn');
  assert.deepEqual(later.results, []);
  // Two copies of one result in one request are both recorded, so the self-test sees the call answered twice.
  const twice = decide({ ...offer, messages: [{ role: 'user', content: [1, 2].map(() => ({ type: 'tool_result', tool_use_id: 'toolu_sandbox_self_test_9', content: 'x' })) }] }, { command: 'c', seen: new Set(), nextId: () => 1 });
  assert.equal(twice.results.length, 2);
});

test('the stand-in speaks the Messages API on 127.0.0.1, streamed or not, only to its own key, and logs no prompt', async t => {
  const s = await startStandIn({ command: 'echo hi' });
  t.after(() => s.close());
  const url = `http://127.0.0.1:${s.port}`;
  const post = (path, body, key = STAND_IN_KEY) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) });
  const streamed = await post('/v1/messages?beta=true', { model: 'claude-sonnet-5-5', stream: true, max_tokens: 9, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'private prompt words' }] });
  assert.equal(streamed.status, 200);
  assert.match(streamed.headers.get('content-type'), /^text\/event-stream/);
  const events = (await streamed.text()).split('\n\n').filter(Boolean).map(block => {
    const [event, data] = block.split('\n');
    return { event: event.slice('event: '.length), data: JSON.parse(data.slice('data: '.length)) };
  });
  assert.deepEqual(events.map(e => e.event), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  for (const e of events) assert.equal(e.data.type, e.event);
  assert.equal(events[0].data.message.model, 'claude-sonnet-5-5');
  assert.equal(events[1].data.content_block.name, 'Bash');
  assert.deepEqual(JSON.parse(events[2].data.delta.partial_json), { command: 'echo hi', description: 'Sandbox self-test command' });
  assert.equal(events[4].data.delta.stop_reason, 'tool_use');
  const id = events[1].data.content_block.id;
  const plain = await post('/v1/messages', { model: 'm', max_tokens: 9, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'hi\n' }] }] });
  const message = await plain.json();
  assert.equal(message.type, 'message');
  assert.equal(message.stop_reason, 'end_turn');
  assert.deepEqual(s.results, [{ id, isError: false, text: 'hi\n' }]);
  assert.deepEqual(await (await post('/v1/messages/count_tokens', { messages: [] })).json(), { input_tokens: 1 });
  // Any other key, method or path is refused, and nothing is recorded from it.
  assert.equal((await post('/v1/messages', { tools: [{ name: 'Bash' }], messages: [] }, 'sk-ant-api03-a-real-looking-key')).status, 401);
  assert.equal((await fetch(`${url}/v1/models`)).status, 404);
  assert.equal((await post('/v1/complete', {})).status, 404);
  assert.equal(s.results.length, 1);
  assert.doesNotMatch(JSON.stringify(s.requests), /private prompt words|sk-ant|placeholder/);
});

// The self-test's own runs: one with the build and one without, each in its own folder with its own call id.
const EXPECTED = ['run-one-command, with the build', 'run-one-command, without the build'];
const selfRuns = (runs = [['with', 'claude-eval-a'], ['without', 'claude-eval-b']], text = working, isError = false) => ({
  raw: report(runs.map(([arm, folder]) => ['run-one-command', arm, folder])),
  traces: Object.fromEntries(runs.map(([, folder]) => [folder, trace([bash(PROBE_COMMAND, isError, text(folder))], folder)])),
  results: runs.map(([, folder]) => ({ id: `${folder}_0`, isError, text: text(folder) })),
});
const judged = (s, options = {}) => judge(s.results, { expected: EXPECTED, raw: s.raw, traces: s.traces, hostUserns: HOST, ...options });
const failing = (s, options) => {
  const v = judged(s, options);
  assert.equal(v.pass, false);
  return v.problems.join('\n');
};

test("the self-test expects exactly the runs its own fixture asks for: one case, once with the build and once without", () => {
  assert.deepEqual(expectedRuns(root), EXPECTED);
  const trial = JSON.parse(read('.github/sandbox-self-test/trial/trial.json'));
  assert.deepEqual(trial.cases.map(c => c.name), ['run-one-command']);
  assert.match(read('.github/sandbox-self-test/trial/cases/run-one-command/prompt.md'), /^runs: 1$/m);
  assert.deepEqual(judged(selfRuns()), { pass: true, problems: [] });
});

test('the self-test fails when a run it asks for is missing, an extra run appears, or a result is duplicated or missing', () => {
  // The first review's case: the report lists only the run with the build, with its one result and its trace.
  assert.match(failing(selfRuns([['with', 'claude-eval-a']])), /^the eval reported 1 agent run \(run-one-command, with the build\), but the self-test's trial asks for exactly 2 agent runs \(run-one-command, with the build; run-one-command, without the build\)$/m);
  assert.match(failing(selfRuns([['without', 'claude-eval-b']])), /^the eval reported 1 agent run \(run-one-command, without the build\)/m);
  // An extra run.
  assert.match(failing(selfRuns([['with', 'claude-eval-a'], ['without', 'claude-eval-b'], ['with', 'claude-eval-c']])), /^the eval reported 3 agent runs /m);
  // A third result, a missing result, and a call recorded twice in its run's own trace.
  const third = selfRuns();
  third.results.push(third.results[0]);
  assert.match(failing(third), /the stand-in received 2 results for claude-eval-a_0, not one/);
  const short = selfRuns();
  short.results.pop();
  assert.match(failing(short), /agent run \(run-one-command, without the build\): the stand-in never received the result of its call claude-eval-b_0/);
  const doubled = selfRuns();
  doubled.traces['claude-eval-a'] = trace([bash(PROBE_COMMAND, false, working('claude-eval-a')), bash(PROBE_COMMAND, false, working('claude-eval-a'))], 'claude-eval-a');
  assert.match(failing(doubled), /agent run \(run-one-command, with the build\): its trace holds 2 Bash call\(s\) with a result/);
  // A run that left no trace, and no report at all.
  const traceless = selfRuns();
  delete traceless.traces['claude-eval-b'];
  const why = failing(traceless);
  assert.match(why, /agent run \(run-one-command, without the build\) left no readable trace of its own/);
  assert.match(why, /the after-trial check would not accept this run: This run is not a measurement: 1 trace the eval's report names was not found/);
  assert.match(failing({ ...selfRuns(), raw: null }), /^the eval wrote no readable report/m);
  // A trace of no reported run.
  const stray = selfRuns();
  stray.traces['claude-eval-z'] = trace([bash('ls', false, 'a')], 'claude-eval-z');
  assert.match(failing(stray), /^1 trace\(s\) belong to no reported agent run: claude-eval-z$/m);
});

test('the self-test binds each result to its own call and its own trace: identical counts and texts are not enough', () => {
  // The second review's first case: both reported runs point at one trace, and two distinct results arrive.
  const shared = selfRuns();
  shared.raw = report([['run-one-command', 'with', 'claude-eval-a'], ['run-one-command', 'without', 'claude-eval-a']]);
  delete shared.traces['claude-eval-b'];
  const one = failing(shared);
  assert.match(one, /^1 trace\(s\) are named by more than one reported agent run: claude-eval-a$/m);
  assert.match(one, /the stand-in received 1 result\(s\) for claude-eval-b_0, a call no reported run's trace holds/);
  assert.match(one, /the after-trial check would not accept this run: .*1 trace is named by more than one agent run/);
  // Its second case: two traces with their own calls, identical output, and the first call's result twice in place of
  // the second's. The count matches and every text passes.
  const same = selfRuns(undefined, () => 'probe=42\nseccomp=2\nuserns=user:[101]');
  same.results = [same.results[0], same.results[0]];
  const two = failing(same);
  assert.match(two, /the stand-in received 2 results for claude-eval-a_0, not one/);
  assert.match(two, /agent run \(run-one-command, without the build\): the stand-in never received the result of its call claude-eval-b_0/);
  // The first round's same-count check, kept: the right ids, but one result is not what its trace holds.
  const differs = selfRuns();
  differs.results[1] = { ...differs.results[1], text: working('claude-eval-a') };
  assert.match(failing(differs), /agent run \(run-one-command, without the build\): the result the stand-in received for claude-eval-b_0 differs from the one its trace holds/);
  const flipped = selfRuns();
  flipped.results[1] = { ...flipped.results[1], isError: true };
  assert.match(failing(flipped), /agent run \(run-one-command, without the build\): the result the stand-in received for claude-eval-b_0 differs from the one its trace holds/);
  // A traced call that is not the self-test command, even with passing output.
  const other = selfRuns();
  other.traces['claude-eval-a'] = trace([bash('cat probe-output.txt', false, working('claude-eval-a'))], 'claude-eval-a');
  assert.match(failing(other), /agent run \(run-one-command, with the build\): its traced Bash call ran "cat probe-output\.txt", not the self-test command/);
  // A result for a call no trace holds, at the right count.
  const foreign = selfRuns();
  foreign.results[1] = { ...foreign.results[1], id: 'toolu_made_up' };
  assert.match(failing(foreign), /the stand-in received 1 result\(s\) for toolu_made_up, a call no reported run's trace holds/);
});

test('the self-test passes only on exit 0 with the expected lines, from inside the sandbox', () => {
  // The pilot: the sandbox's helper failed, so the command never started.
  const pilot = failing(selfRuns(undefined, () => PILOT, true));
  assert.match(pilot, /agent run \(run-one-command, with the build\): the command did not exit 0; the Bash tool returned .*apply-seccomp/);
  assert.match(pilot, /the after-trial check would not accept this run: This run is not a measurement: the sandbox kept 2 of the 2 shell commands/);
  // Run beside the sandbox: the command ran, with no seccomp filter and in the runner's own namespace.
  const beside = failing(selfRuns(undefined, () => `probe=42\nseccomp=0\nuserns=${HOST}`));
  assert.match(beside, /no line seccomp=2/);
  assert.match(beside, /in this runner's own user namespace/);
  // A filter in the runner's own namespace, or another namespace with no filter, is not enough on its own.
  assert.match(failing(selfRuns(undefined, () => `probe=42\nseccomp=2\nuserns=${HOST}`)), /own user namespace/);
  assert.match(failing(selfRuns(undefined, () => 'probe=42\nuserns=user:[7]')), /no line seccomp=2/);
  assert.match(failing(selfRuns(undefined, () => 'probe=42\nseccomp=2')), /no line userns=/);
  // The shell's own answer, once: the command's text echoed back, or two answers, prove nothing.
  assert.match(failing(selfRuns(undefined, () => `${PROBE_COMMAND}\nseccomp=2\nuserns=user:[7]`)), /no line probe=42/);
  assert.match(failing(selfRuns(undefined, () => 'probe=42\nprobe=42\nseccomp=2\nuserns=user:[7]')), /no line probe=42/);
  // Claude Code's exit line means the command did not exit 0, even on a result not marked as an error.
  assert.match(failing(selfRuns(undefined, folder => `Exit code 1\n${working(folder)}`)), /did not exit 0/);
});

test('the self-test command run beside the sandbox, on this machine, fails the self-test', () => {
  const r = spawnSync('bash', ['-c', PROBE_COMMAND], { encoding: 'utf8' });
  assert.match(r.stdout, /^probe=42$/m);
  let host = 'none';
  try { host = readlinkSync('/proc/self/ns/user'); } catch {}
  const s = selfRuns(undefined, () => r.stdout + r.stderr, r.status !== 0);
  assert.equal(judged(s, { hostUserns: host }).pass, false);
});

test('the CLI under the self-test gets the stand-in and its placeholder key, never a real key or provider', () => {
  const env = standInEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-api03-real', ANTHROPIC_CUSTOM_HEADERS: 'anthropic-workspace-id: w', ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1' }, 4321, '/t');
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', ANTHROPIC_BASE_URL: 'http://127.0.0.1:4321', ANTHROPIC_API_KEY: STAND_IN_KEY, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', TMPDIR: '/t' });
  // The CLI runs with the run step's own flags, on the self-test's build and trial.
  const runStep = workflow.split('\n').find(line => /node cli\/buildguild\.mjs test /.test(line));
  const flags = argv => argv.filter(a => /^-/.test(a)).filter(a => a !== '--rep');
  assert.deepEqual(flags(cliArgs({ root: '/r', model: 'm', base: '/b' })), flags(runStep.trim().split(/\s+/)));
  assert.deepEqual(cliArgs({ root: '/r', model: 'm', base: '/b' }).slice(0, 5), ['/r/cli/buildguild.mjs', 'test', '/r/.github/sandbox-self-test/empty-build', '--trial', '/r/.github/sandbox-self-test/trial']);
});

// A stub claude for the CLI under the self-test: as `plugin eval` it plays the arms STUB_PLAN names (both by default)
// against whatever model API it is given, as Claude Code does, but returns STUB_PLAN's result instead of running the
// command. It writes each run's trace and the raw report and logs what it was started with. Options: `twice` names an
// arm whose trace records its call twice, `noTrace` writes no trace, `noReport` writes nothing, `shareTrace` points
// every run in the report at the first run's trace, and `firstResultTwice` makes the first run answer the stand-in with
// two copies of its result in one request while the second run never sends its own.
const stubClaude = `#!${process.execPath}
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.322 (Claude Code)'); process.exit(0); }
const plan = JSON.parse(process.env.STUB_PLAN);
appendFileSync(process.env.STUB_LOG, JSON.stringify({ args, base: process.env.ANTHROPIC_BASE_URL, key: process.env.ANTHROPIC_API_KEY, headers: process.env.ANTHROPIC_CUSTOM_HEADERS ?? null, tmp: process.env.TMPDIR, quiet: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC }) + '\\n');
if (plan.noReport) process.exit(1);
(async () => {
  const arms = { with: [], without: [] };
  const post = body => fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY }, body: JSON.stringify(body) }).then(r => r.json());
  let firstTrace;
  for (const [i, arm] of (plan.arms || ['with', 'without']).entries()) {
    const ask = { model: 'claude-sonnet-5-5', max_tokens: 9, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'Run the sandbox self-test command.' }] };
    const call = (await post(ask)).content.find(b => b.type === 'tool_use');
    const result = { type: 'tool_result', tool_use_id: call.id, content: plan.text, ...(plan.isError ? { is_error: true } : {}) };
    const out = join(process.env.TMPDIR, 'claude-eval-' + i + arm, 'out');
    mkdirSync(out, { recursive: true });
    const record = plan.isError ? 'Error: ' + plan.text : { stdout: plan.text, stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
    const lines = [{ type: 'assistant', message: { role: 'assistant', content: [call] } }, { type: 'user', message: { role: 'user', content: [result] }, tool_use_result: record }];
    if (plan.twice === arm) lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ ...call, id: call.id + '_again' }] } }, { type: 'user', message: { role: 'user', content: [{ ...result, tool_use_id: call.id + '_again' }] }, tool_use_result: record });
    const written = !plan.noTrace && !(plan.shareTrace && i > 0);
    if (written) writeFileSync(join(out, 'trace.jsonl'), lines.map(e => JSON.stringify(e)).join('\\n') + '\\n');
    const answer = plan.firstResultTwice ? (i === 0 ? [result, result] : null) : [result];
    if (answer) await post({ ...ask, messages: [...ask.messages, { role: 'assistant', content: [call] }, { role: 'user', content: answer }] });
    if (i === 0) firstTrace = join(out, 'trace.jsonl');
    arms[arm].push({ score: 1, error: null, tracePath: plan.shareTrace ? firstTrace : join(out, 'trace.jsonl') });
  }
  writeFileSync('buildguild-raw.json', JSON.stringify({ claudeVersion: '2.1.322', costUsd: 0, partial: false, cases: [{ name: 'run-one-command', arms, aggregates: { score: 1 } }], aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0 } }));
})();
`;

test('the self-test runs the CLI against the stand-in only, and its verdict follows the runs and results that came back', async t => {
  const dir = temp(t, 'bg-self-test-');
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'claude'), stubClaude, { mode: 0o755 });
  const run = async (name, plan) => {
    const base = join(dir, name);
    const log = join(dir, `${name}.log`);
    writeFileSync(log, '');
    const env = { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, BUILDGUILD_ORIGIN: 'http://127.0.0.1:9', STUB_LOG: log, STUB_PLAN: JSON.stringify(plan), ANTHROPIC_API_KEY: 'sk-ant-api03-real-looking', ANTHROPIC_CUSTOM_HEADERS: 'anthropic-workspace-id: wrkspc_real', ANTHROPIC_BASE_URL: 'https://api.anthropic.com' };
    const r = await selfTest({ root, model: 'claude-sonnet-5-5', base, env, hostUserns: HOST, timeoutMs: 60000, log: () => {}, stdio: 'ignore' });
    return { ...r, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)), base };
  };
  const good = await run('good', { text: working('x') });
  assert.equal(good.status, 0);
  assert.deepEqual(good.verdict, { pass: true, problems: [] });
  assert.equal(good.results.length, 2);
  // One plugin eval with the trial's flags, both arms included, which saw only the stand-in, its placeholder key and
  // the self-test's temp folder, although the environment it started from held a real-looking key, header and address.
  assert.equal(good.calls.length, 1);
  const [call] = good.calls;
  assert.deepEqual(call.args.slice(0, 9), ['plugin', 'eval', '.', '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit', '--json']);
  assert.ok(call.args.includes('--keep-temp') && call.args.includes('--no-publish'));
  assert.equal(call.args[call.args.indexOf('--ablation') + 1], 'with-without');
  assert.equal(call.args[call.args.indexOf('--max-cost-usd') + 1], '0.01');
  assert.match(call.base, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(call.key, STAND_IN_KEY);
  assert.equal(call.headers, null);
  assert.equal(call.quiet, '1');
  assert.equal(call.tmp, join(good.base, 'tmp'));
  // The pilot: the CLI and the eval end green, and the self-test does not.
  const pilot = await run('pilot', { isError: true, text: PILOT });
  assert.equal(pilot.status, 0);
  assert.equal(pilot.verdict.pass, false);
  assert.match(pilot.verdict.problems[0], /^agent run \(run-one-command, with the build\): the command did not exit 0/);
  // The first review's case: one arm only, with its one result and trace, and the CLI at exit 0.
  const oneArm = await run('one-arm', { text: working('x'), arms: ['with'] });
  assert.equal(oneArm.status, 0);
  assert.equal(oneArm.verdict.pass, false);
  assert.match(oneArm.verdict.problems[0], /^the eval reported 1 agent run \(run-one-command, with the build\), but the self-test's trial asks for exactly 2 agent runs/);
  // The second review's cases: both runs pointing at one trace, and the first result twice in place of the second.
  const shared = await run('shared', { text: working('x'), shareTrace: true });
  assert.equal(shared.status, 0);
  assert.equal(shared.verdict.pass, false);
  assert.match(shared.verdict.problems.join('\n'), /are named by more than one reported agent run/);
  const firstTwice = await run('first-twice', { text: working('x'), firstResultTwice: true });
  assert.equal(firstTwice.status, 0);
  assert.equal(firstTwice.verdict.pass, false);
  assert.deepEqual(firstTwice.results.map(r => r.id), ['toolu_sandbox_self_test_1', 'toolu_sandbox_self_test_1']);
  assert.match(firstTwice.verdict.problems.join('\n'), /the stand-in received 2 results for toolu_sandbox_self_test_1, not one/);
  assert.match(firstTwice.verdict.problems.join('\n'), /never received the result of its call toolu_sandbox_self_test_2/);
  // An extra run, and a run whose trace records its call twice.
  const extra = await run('extra', { text: working('x'), arms: ['with', 'without', 'with'] });
  assert.match(extra.verdict.problems[0], /^the eval reported 3 agent runs /);
  const twice = await run('twice', { text: working('x'), twice: 'without' });
  assert.equal(twice.verdict.pass, false);
  assert.match(twice.verdict.problems.join('\n'), /agent run \(run-one-command, without the build\): its trace holds 2 Bash call\(s\) with a result/);
  // Results the traces do not hold, and an eval that writes no report.
  const untraced = await run('untraced', { text: working('x'), noTrace: true });
  assert.equal(untraced.verdict.pass, false);
  assert.match(untraced.verdict.problems.join('\n'), /left no readable trace of its own/);
  const broken = await run('broken', { noReport: true });
  assert.equal(broken.status, 1);
  assert.equal(broken.verdict.pass, false);
  assert.match(broken.verdict.problems[0], /^the CLI ended with exit status 1, not 0/);
});

test("the after-trial rule reads each result's shape: a process exit, an allowed refusal, or an error that is neither", () => {
  const kind = ([isError, text, meta]) => kindOf(isError, text, meta);
  // As Claude Code 2.1.322 wrote them: exits, a grep miss it reads as success, and refusals before the command ran.
  assert.deepEqual(Object.fromEntries(Object.entries(OBSERVED).map(([k, v]) => [k, kind(v)])), {
    'exit 0': 'success', 'exit 3': 'failed', 'grep miss': 'success', 'git diff, files differ': 'success', 'started in the background': 'success', 'runs past its timeout': 'success', 'hook exits 2': 'refused', 'hook denies by JSON': 'refused', 'malformed input': 'refused', 'long sleep': 'refused',
  });
  // On the broken image: the helper's line, behind "Exit code 1" or as the whole output of a grep read as success.
  for (const v of Object.values(BROKEN)) assert.equal(kind(v), 'stopped', v[1]);
  assert.equal(kindOf(true, PILOT, ACCEPT), 'stopped');
  // Errors that are no process exit, whatever their wording: the review's bridge error, Claude Code's refusals and an
  // interrupted command. None of them is matched by its text.
  for (const text of FROM_SOURCE) assert.equal(kindOf(true, text, ACCEPT), 'not-an-exit', text);
  assert.equal(kindOf(true, `Error: Exit code 1\n${SECCOMP_HELPER}`, ACCEPT), 'not-an-exit');
  // A hook's words with no hook decision behind them, or a validation tag around other words, are not refusals.
  assert.equal(kindOf(true, OBSERVED['hook exits 2'][1], ACCEPT), 'not-an-exit');
  assert.equal(kindOf(true, '<tool_use_error>Blocked: no reason given</tool_use_error>', undefined), 'not-an-exit');
  assert.equal(kindOf(true, '<tool_use_error>Error calling tool (Bash): spawn E2BIG</tool_use_error>', undefined), 'not-an-exit');
  // Ordinary failures of a command that ran stay failures.
  for (const text of [`Exit code 1\n${BASHRC}\n${BASHRC}\nFAIL tests/sum.test.js\n  expected 3, got 4`, 'Exit code 1', `Exit code 1\n${BASHRC}`, 'Exit code 127\n/bin/bash: line 1: pytest: command not found', 'Exit code 1\nchecking the sandbox\nbwrap: No permissions to create a new namespace', 'Exit code 1\napply-seccomp: oops', 'Exit code 1\nlog: apply-seccomp: write /proc/self/setgroups: Permission denied']) {
    assert.equal(kindOf(true, text, ACCEPT), 'failed', text);
  }
  assert.equal(kindOf(false, `${BASHRC}\nREADME.md`, ACCEPT), 'success');
  assert.deepEqual(SETUP_LINES.map(String), ['/^bwrap: \\S/', '/^apply-seccomp: .+: \\S/']);
  assert.equal(ALLOWED_REFUSALS.length, 3);
});

test("the stated limit, with real bash: the review's ordinary script is a failure, and a script that prints only a setup-shaped line counts as stopped", () => {
  const ran = command => {
    const r = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
    return [r.status, kindOf(r.status !== 0, `${r.status !== 0 ? `Exit code ${r.status}\n` : ''}${r.stdout}${r.stderr}`, ACCEPT)];
  };
  assert.deepEqual(ran("printf 'Sandbox is required for deployment\\n' >&2; exit 1"), [1, 'failed']);
  assert.deepEqual(ran("printf 'bwrap: cannot reach the mirror\\n' >&2; exit 1"), [1, 'stopped']);
  assert.deepEqual(ran("printf 'apply-seccomp: open config: No such file or directory\\n' >&2; exit 1"), [1, 'stopped']);
  // Even at exit 0: such output alone counts as stopped, which can only reject a run.
  assert.deepEqual(ran("printf 'bwrap: cannot reach the mirror\\n'"), [0, 'stopped']);
});

test('a trace is read in full: its requests, their results, and every line that cannot be read', () => {
  // A result before its request still pairs; a request answered twice takes its worst result.
  const lines = entries([bash('ls', false, 'a'), bash('make', true, 'Exit code 1\nFAIL')]);
  const swapped = [lines[1], lines[0], lines[2], lines[3], { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: `Exit code 1\n${SECCOMP_HELPER}` }] } }].map(e => JSON.stringify(e)).join('\n');
  const readBack = bashCalls(swapped);
  assert.deepEqual(readBack.calls.map(c => [c.command, c.kind]), [['ls', 'success'], ['make', 'stopped']]);
  assert.deepEqual([readBack.unanswered, readBack.unreadable, readBack.empty], [[], 0, false]);
  // Whether a call exited 0 comes from Claude Code's record beside its result: not an exit status 1 it reads as
  // success, not a command it ran in the background, not interrupted, and only from a record that is there.
  const records = bashCalls(trace(['exit 0', 'grep miss', 'git diff, files differ', 'started in the background', 'runs past its timeout', 'exit 3'].map(k => shape(OBSERVED[k]))));
  assert.deepEqual(records.calls.map(c => c.exitedZero), [true, false, false, false, false, false]);
  assert.equal(bashCalls(trace([bash('ls', false, 'a', ACCEPT, { ...RECORD('a'), interrupted: true })])).calls[0].exitedZero, false);
  assert.equal(bashCalls(trace([['Bash', { command: 'ls' }, false, 'a', ACCEPT]])).calls[0].exitedZero, false);
  assert.equal(bashCalls(trace([bash('ls', false, 'a', ACCEPT, 'a')])).calls[0].exitedZero, false);
  // A line holding two results has no record that tells them apart, and a request answered twice exited 0 only if
  // both of its results say so.
  const two = [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }, { type: 'tool_use', id: 'y', name: 'Bash', input: { command: 'pwd' } }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'a' }, { type: 'tool_result', tool_use_id: 'y', content: '/' }] }, tool_use_result: RECORD('a') }];
  assert.deepEqual(bashCalls(two.map(e => JSON.stringify(e)).join('\n')).calls.map(c => [c.kind, c.exitedZero]), [['success', false], ['success', false]]);
  const again = entries([bash('ls', false, 'a')]);
  again.push({ ...again[1], tool_use_result: RECORD('a', { backgroundTaskId: 'b1' }) });
  assert.deepEqual(bashCalls(again.map(e => JSON.stringify(e)).join('\n')).calls.map(c => [c.kind, c.exitedZero]), [['success', false]]);
  assert.deepEqual(bashCalls([...again.slice(0, 2), again[1]].map(e => JSON.stringify(e)).join('\n')).calls.map(c => c.exitedZero), [true]);
  // The meta that belongs to a result is the entry with its id.
  const metaRead = bashCalls(trace([shape(OBSERVED['hook exits 2'])]));
  assert.deepEqual([metaRead.calls[0].kind, metaRead.calls[0].meta.permission_decision.source], ['refused', 'hook']);
  // A request with no result, lines that are not JSON objects, and empty traces.
  assert.deepEqual(bashCalls(trace([bash('npm test', undefined, undefined)])).unanswered, [{ id: 'toolu_0', command: 'npm test' }]);
  assert.equal(bashCalls(`${trace([bash('ls', false, 'a')])}5\nnull\n[1]\n{"type":`).unreadable, 4);
  assert.equal(bashCalls('').empty, true);
  assert.equal(bashCalls('\n \n').empty, true);
  assert.equal(bashCalls('{not json').empty, false);
  // Results written as text blocks are read like plain text, and other tools are not Bash requests.
  const blocks = bashCalls(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'c' } }, { type: 'tool_use', id: 'y', name: 'Read', input: {} }] } }) + '\n' + JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{ type: 'text', text: 'Exit code 1' }, { type: 'text', text: SECCOMP_HELPER }] }] } }));
  assert.deepEqual([blocks.calls.length, blocks.calls[0].kind, blocks.unanswered.length], [1, 'stopped', 0]);
  // The report's runs, named by case and arm, with the folder of each trace.
  assert.deepEqual(runsIn(report([['c', 'with', 'claude-eval-a'], ['c', 'without', 'claude-eval-b']])), [{ name: 'c, with the build', trace: 'claude-eval-a' }, { name: 'c, without the build', trace: 'claude-eval-b' }]);
  assert.deepEqual(runsIn(report([['c', 'with', null]])), [{ name: 'c, with the build', trace: null }]);
});

test('the after-trial verdict: a measurement only on positive evidence, and one stopped or failed-to-run call among healthy ones is enough to reject', () => {
  const healthy = {
    'claude-eval-a': [bash('npm test', true, `Exit code 1\n${BASHRC}\nFAIL tests/sum.test.js`), bash('ls', false, 'README.md'), ['Read', { file_path: '/x' }, true, SECCOMP_HELPER], shape(OBSERVED['hook exits 2'], 'git push --force')],
    'claude-eval-b': [bash('./deploy.sh', true, 'Exit code 1'), bash('pytest', true, 'Exit code 127\n/bin/bash: line 1: pytest: command not found'), shape(OBSERVED['grep miss'], 'grep zzz f')],
  };
  const fine = verdictOf(healthy);
  assert.equal(fine.measurement, true);
  assert.equal(fine.sentence, "No result shows the sandbox keeping a command from starting: none of the 5 shell commands Claude Code tried to run for the agents was kept from starting or ended in an error from Claude Code, and 1 exited 0 (1 other was refused before running, by a hook or an input check); each of the 2 agent runs in the eval's report left its own complete trace.");
  // A complete trace with no shell command in it is still a measurement, and so is one whose only call a hook stopped.
  assert.equal(verdictOf({ 'claude-eval-a': [['Read', { file_path: '/x' }, false, 'text']] }).sentence, "No result shows the sandbox keeping a command from starting: Claude Code tried to run no shell command for the agents; each of the 1 agent run in the eval's report left its own complete trace.");
  assert.equal(verdictOf({ 'claude-eval-a': [shape(OBSERVED['hook denies by JSON'])] }).measurement, true);
  const not = byFolder => { const v = verdictOf(byFolder); assert.equal(v.measurement, false); return v.sentence; };
  // Kept from the first round: one stopped call among healthy runs rejects the run.
  const mixed = verdictOf({ ...healthy, 'claude-eval-c': [bash('ls', false, 'a'), bash('make', true, 'Exit code 1\nbwrap: setting up uid map: Permission denied')] });
  assert.equal(mixed.measurement, false);
  assert.match(mixed.sentence, /the sandbox kept 1 of the 7 shell commands Claude Code tried to run from starting, in 1 of 3 agent runs/);
  assert.deepEqual(mixed.stopped.map(c => [c.trace, c.command]), [['claude-eval-c', 'make']]);
  // A grep stopped by the sandbox, which Claude Code reads as success, among healthy calls.
  assert.match(not({ ...healthy, 'claude-eval-c': [shape(BROKEN['grep miss, sandbox broken'], 'grep x f')] }), /the sandbox kept 1 of the 6 shell commands/);
  // One error that is no exit among healthy calls, such as the review's bridge error, quoted in the sentence.
  assert.match(not({ ...healthy, 'claude-eval-c': [bash('ls', true, FROM_SOURCE[0])] }), /1 shell command ended in an error from Claude Code instead of an exit of the command \(the first: Linux sandbox HTTP bridge socket is missing \(socat may have died\)\. Restart to retry\.\)/);
  // Not one shell command exited 0, in the whole job.
  assert.equal(not({ 'claude-eval-a': [bash('npm test', true, 'Exit code 1\nFAIL')], 'claude-eval-b': [bash('make', true, 'Exit code 2\nerror')] }), 'This run is not a measurement: Claude Code tried to run 2 shell commands for the agents and not one exited 0.');
  // Results Claude Code does not mark as errors are no exit 0 either when its record says an exit status 1 was read as
  // success, or the command went to the background, on request or past its timeout, as 2.1.322 wrote them.
  const noZero = { 'claude-eval-a': [shape(OBSERVED['grep miss'], 'grep zzz f'), shape(OBSERVED['git diff, files differ'], 'git diff --quiet')], 'claude-eval-b': [shape(OBSERVED['started in the background'], 'npm run dev'), shape(OBSERVED['runs past its timeout'], 'make')] };
  assert.equal(not(noZero), 'This run is not a measurement: Claude Code tried to run 4 shell commands for the agents and not one exited 0.');
  // Nor is a command the sandbox stopped, even with a clean record, or a success with no record beside it; one exit 0
  // anywhere in the job is enough.
  assert.match(not({ 'claude-eval-a': [bash('echo hi', false, 'bwrap: cannot reach the mirror')] }), /the sandbox kept 1 of the 1 shell commands .*; Claude Code tried to run 1 shell command for the agents and not one exited 0\.$/);
  assert.match(not({ ...noZero, 'claude-eval-c': [['Bash', { command: 'ls' }, false, 'a', ACCEPT]] }), /tried to run 5 shell commands for the agents and not one exited 0\.$/);
  assert.equal(verdictOf({ ...noZero, 'claude-eval-c': [shape(OBSERVED['exit 0'], 'echo hi')] }).measurement, true);
  // The pilot: every call stopped, so no success either.
  const pilot = verdictOf({ 'claude-eval-p': [bash('git status', true, PILOT)], 'claude-eval-q': [bash('ls', true, PILOT), bash('make', true, PILOT)], 'claude-eval-r': [['Read', { file_path: '/x' }, false, 'text']] });
  assert.deepEqual([pilot.measurement, pilot.stopped.length], [false, 3]);
  assert.equal(pilot.sentence, `This run is not a measurement: the sandbox kept 3 of the 3 shell commands Claude Code tried to run from starting, in 2 of 3 agent runs, so every grader that needed one of them failed (the first ended with: ${SECCOMP_HELPER}); Claude Code tried to run 3 shell commands for the agents and not one exited 0.`);
});

test('the after-trial verdict: the report and the traces must be complete and pair one trace to one run', () => {
  const not = (traces, raw) => { const v = verdict(traces, raw); assert.equal(v.measurement, false); return v.sentence; };
  const pilotTrace = trace([bash('git status', true, `Exit code 1\n${SECCOMP_HELPER}`)], 'claude-eval-a').trimEnd();
  const raw1 = report([['c', 'with', 'claude-eval-a']]);
  const one = text => ({ 'claude-eval-a': text });
  // The first review's three traces: the result line cut short, a request with no result, a wholly malformed trace.
  assert.equal(not(one(pilotTrace.slice(0, -1)), raw1), 'This run is not a measurement: 1 trace line could not be read; 1 shell command the agents asked for got no result in the trace, as when a run is cut off in the middle of a command.');
  assert.equal(not(one(pilotTrace.split('\n')[0]), raw1), 'This run is not a measurement: 1 shell command the agents asked for got no result in the trace, as when a run is cut off in the middle of a command.');
  assert.equal(not(one('{"type":"assistant","message":\nnot json at all\n'), raw1), 'This run is not a measurement: 2 trace lines could not be read.');
  // An empty trace file, or one that could not be opened.
  assert.equal(not(one(''), raw1), 'This run is not a measurement: 1 trace file was empty.');
  assert.equal(not({ 'claude-eval-a': null }, raw1), 'This run is not a measurement: 1 trace file could not be opened.');
  // The second review's case: two runs naming one trace, whose single call succeeded.
  const good = trace([bash('ls', false, 'a')], 'claude-eval-a');
  assert.equal(not(one(good), report([['c', 'with', 'claude-eval-a'], ['c', 'without', 'claude-eval-a']])), "This run is not a measurement: 1 trace is named by more than one agent run in the eval's report, so some run left no trace of its own.");
  // A run that names no trace, a named trace not found, a trace of no run, no report, and a report of no runs.
  assert.equal(not(one(good), report([['c', 'with', 'claude-eval-a'], ['c', 'without', null]])), "This run is not a measurement: 1 agent run in the eval's report names no trace.");
  assert.equal(not(one(good), report([['c', 'with', 'claude-eval-a'], ['d', 'with', 'claude-eval-b']])), "This run is not a measurement: 1 trace the eval's report names was not found.");
  assert.equal(not({ 'claude-eval-a': good, 'claude-eval-z': good }, raw1), "This run is not a measurement: 1 trace found belongs to no agent run in the eval's report.");
  assert.equal(not(one(good), null), 'This run is not a measurement: the eval left no readable report of its agent runs, so nothing shows that each one left its trace.');
  assert.equal(not({}, { cases: [] }), "This run is not a measurement: the eval's report lists no agent runs.");
  assert.equal(not({}, raw1), "This run is not a measurement: 1 trace the eval's report names was not found.");
});

test('the after-trial check fails the job and says why in its log, the job summary and the step outputs', t => {
  const dir = temp(t, 'bg-shell-starts-');
  const runIn = (traces, raw) => {
    const folder = mkdtempSync(join(dir, 'evaltmp-'));
    for (const [name, text] of Object.entries(traces)) { mkdirSync(join(folder, name, 'out'), { recursive: true }); writeFileSync(join(folder, name, 'out', 'trace.jsonl'), text); }
    const rawPath = join(folder, 'raw.json');
    if (raw !== undefined) writeFileSync(rawPath, typeof raw === 'string' ? raw : JSON.stringify(raw));
    writeFileSync(join(folder, 'output'), '');
    writeFileSync(join(folder, 'summary'), '');
    const r = spawnSync(process.execPath, [join(root, '.github/scripts/shell-starts.mjs'), folder, rawPath], { encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_OUTPUT: join(folder, 'output'), GITHUB_STEP_SUMMARY: join(folder, 'summary') } });
    return { ...r, output: readFileSync(join(folder, 'output'), 'utf8'), summary: readFileSync(join(folder, 'summary'), 'utf8') };
  };
  const raw1 = report([['c', 'with', 'claude-eval-a']]);
  const bad = runIn({ 'claude-eval-a': trace([bash('ls', false, 'a'), bash('ls', true, 'Exit code 1\nbwrap: odd\rline')], 'claude-eval-a') }, raw1);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^::error::This run is not a measurement: /m);
  assert.match(bad.summary, /^### Not a measurement\n\nThis run is not a measurement: the sandbox kept 1 of the 2 /);
  // Two output lines, whatever the trace held: the carriage return in the sandbox's line is dropped.
  assert.deepEqual(bad.output.split('\n'), ['measurement=false', 'sentence=This run is not a measurement: the sandbox kept 1 of the 2 shell commands Claude Code tried to run from starting, in 1 of 1 agent run, so every grader that needed one of them failed (the first ended with: bwrap: oddline).', '']);
  const good = runIn({ 'claude-eval-a': trace([bash('npm test', true, 'Exit code 1\nFAIL'), bash('ls', false, 'a')], 'claude-eval-a') }, raw1);
  assert.equal(good.status, 0);
  assert.equal(good.output.split('\n')[0], 'measurement=true');
  assert.doesNotMatch(good.summary, /Not a measurement/);
  // The reviews' traces fail it through the command line too: three incomplete ones and an empty one, two runs naming
  // one trace, and the bridge error.
  const pilotTrace = trace([bash('git status', true, `Exit code 1\n${SECCOMP_HELPER}`)], 'claude-eval-a').trimEnd();
  for (const [traces, raw] of [
    ...[pilotTrace.slice(0, -1), pilotTrace.split('\n')[0], '{"type":"assistant","message":\nnot json at all\n', ''].map(text => [{ 'claude-eval-a': text }, raw1]),
    [{ 'claude-eval-a': trace([bash('ls', false, 'a')], 'claude-eval-a') }, report([['c', 'with', 'claude-eval-a'], ['c', 'without', 'claude-eval-a']])],
    [{ 'claude-eval-a': trace([bash('ls', true, FROM_SOURCE[0])], 'claude-eval-a') }, raw1],
  ]) {
    const failed = runIn(traces, raw);
    assert.equal(failed.status, 1, JSON.stringify(traces));
    assert.match(failed.output, /^measurement=false\nsentence=This run is not a measurement: /);
    assert.match(failed.summary, /^### Not a measurement\n/);
  }
  // A missing or unreadable raw report fails the check.
  for (const raw of [undefined, '{"cases": [']) {
    const missing = runIn({ 'claude-eval-a': trace([bash('ls', false, 'a')], 'claude-eval-a') }, raw);
    assert.equal(missing.status, 1);
    assert.match(missing.output, /^measurement=false\nsentence=This run is not a measurement: the eval left no readable report/);
  }
  // The real layout: a trace under out/, read from the folder the check is given.
  const folder = mkdtempSync(join(dir, 'layout-'));
  mkdirSync(join(folder, 'claude-eval-a', 'out'), { recursive: true });
  writeFileSync(join(folder, 'claude-eval-a', 'out', 'trace.jsonl'), 'x');
  mkdirSync(join(folder, 'claude-eval-b'));
  mkdirSync(join(folder, 'unrelated'));
  assert.deepEqual(tracesIn(folder), { 'claude-eval-a': 'x' });
  assert.equal(spawnSync(process.execPath, [join(root, '.github/scripts/shell-starts.mjs'), folder], { encoding: 'utf8' }).status, 2);
});

test('the trial job and the free check run the same pinned install on the same pinned image', () => {
  const trialJob = workflow.slice(workflow.indexOf('\n  trial:\n'));
  const image = text => [...text.matchAll(/\n {4}runs-on: (\S+)\n/g)].map(m => m[1]);
  assert.deepEqual(image(trialJob), ['ubuntu-24.04']);
  assert.deepEqual(image(check), ['ubuntu-24.04']);
  for (const text of [trialJob, check]) {
    assert.match(text, /\n {8}run: bash \.github\/scripts\/install-trial-tools\.sh\n/);
    assert.match(text, /\n {8}run: node \.github\/scripts\/sandbox-self-test\.mjs --model /);
  }
  // Claude Code at one exact release, installed by version, and checked after the install.
  const pin = install.match(/\nCLAUDE_CODE_VERSION=(\S+)\n/)[1];
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.match(install, /\nnpm install -g "@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}"\n/);
  assert.equal([...install.matchAll(/npm install/g)].length, 1);
  for (const text of [workflow, check]) assert.doesNotMatch(text, /npm install|apt-get|sysctl/);
  // The one system setting, named with its reason in the script.
  assert.deepEqual(install.split('\n').filter(line => /^sudo sysctl /.test(line)), ['sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0', 'sudo sysctl -w kernel.unprivileged_userns_clone=1 2>/dev/null || true']);
  assert.match(install, /# The system setting: Ubuntu 24\.04 lets a program make an unprivileged user namespace only without capabilities/);
  // The script's own check of what it installed: the pinned release passes, any other stops the job.
  const versionCheck = install.slice(install.indexOf('installed="$(claude --version)"'), install.indexOf('echo "$installed"'));
  const stub = mkdtempSync(join(tmpdir(), 'bg-version-'));
  try {
    for (const [printed, status] of [[`${pin} (Claude Code)`, 0], ['2.1.999 (Claude Code)', 1], [`${pin}`, 1]]) {
      writeFileSync(join(stub, 'claude'), `#!/bin/sh\necho '${printed}'\n`, { mode: 0o755 });
      const r = spawnSync('bash', ['-c', versionCheck], { encoding: 'utf8', env: { PATH: `${stub}:${process.env.PATH}`, CLAUDE_CODE_VERSION: pin } });
      assert.equal(r.status, status, printed);
    }
  } finally {
    rmSync(stub, { recursive: true, force: true });
  }
});

test('the self-test runs before Azure and the key, and the shell check after the trial, on its report, before anything is gathered', () => {
  const trialJob = workflow.slice(workflow.indexOf('\n  trial:\n'));
  const names = [...trialJob.matchAll(/\n {6}- name: ([^\n]+)\n/g)].map(m => m[1]);
  const order = [INSTALL, SELF_TEST, 'Sign in to Azure with the workload identity', 'Fetch the Anthropic key from Key Vault (masked, never printed)', 'Drop the Azure session before any agent runs', 'Stop here when only verifying', 'Check the key works with one tiny call', 'Run the trial', SHELLS, GATHER, 'Scan the files for the key before anything is uploaded', 'Upload the scanned files'];
  assert.deepEqual(names, order);
  for (const name of [INSTALL, SELF_TEST]) assert.match(stepText(name), /^ {8}if: \$\{\{ matrix\.verify_only != 'true' \}\}$/m, name);
  // The self-test reads only the model's name and drops the two token variables, as the key check and the trial do.
  const self = stepText(SELF_TEST);
  assert.match(self, /\n {8}env:\n {10}BG_MODEL: \$\{\{ matrix\.model \}\}\n {8}#/);
  assert.match(self, /\n {8}shell: env -u ACTIONS_ID_TOKEN_REQUEST_TOKEN -u ACTIONS_ID_TOKEN_REQUEST_URL bash -e \{0\}\n {8}run: node \.github\/scripts\/sandbox-self-test\.mjs --model "\$BG_MODEL"\n/);
  // The shell check runs whenever the trial step ran, on the folder the trial's agents ran in and the upload gathers
  // from, and on the raw report the run step wrote.
  const shells = stepText(SHELLS);
  assert.match(shells, /\n {8}id: shells\n {8}if: \$\{\{ always\(\) && matrix\.verify_only != 'true' && steps\.run\.outcome != 'skipped' \}\}\n/);
  assert.match(shells, /\n {8}env:\n {10}BG_BUILD: \$\{\{ matrix\.build \}\}\n {10}BG_TRIAL: \$\{\{ matrix\.trial \}\}\n {10}BG_REP: \$\{\{ matrix\.rep \}\}\n/);
  assert.match(shells, /\n {8}run: node \.github\/scripts\/shell-starts\.mjs "\$RUNNER_TEMP\/evaltmp" "raw-\$BG_BUILD-\$BG_TRIAL\$\{BG_REP:\+-rep\$BG_REP\}\.json"\n/);
  assert.match(stepText('Run the trial'), /\n {8}id: run\n/);
  assert.match(runLines('Run the trial'), /^mkdir -p "\$RUNNER_TEMP\/evaltmp" && export TMPDIR="\$RUNNER_TEMP\/evaltmp"$/m);
  assert.match(runLines('Run the trial'), /^SUFFIX="\$\{BG_REP:\+-rep\$BG_REP\}"$/m);
  assert.match(runLines('Run the trial'), / --raw-out "raw-\$BG_BUILD-\$BG_TRIAL\$SUFFIX\.json" /);
  assert.match(runLines(GATHER), /^for trace in "\$RUNNER_TEMP"\/evaltmp\/claude-eval-\*\/out\/trace\.jsonl; do$/m);
  // The free check holds no secret, no environment and no write permission.
  assert.doesNotMatch(check, /secrets\.|vars\.|environment:|id-token/);
  assert.match(check, /\npermissions:\n {2}contents: read\n/);
  for (const path of ['.github/workflows/trial.yml', '.github/scripts/**', '.github/sandbox-self-test/**', 'cli/**']) assert.ok(check.includes(`'${path}'`), path);
});

test('the gather step renames the record of a run that is not a measurement, beside a note saying why', t => {
  const lines = runLines(GATHER);
  const gather = (measurement, why, rep = '') => {
    const dir = temp(t, 'bg-gather-');
    const suffix = rep ? `-rep${rep}` : '';
    writeFileSync(join(dir, `evidence-lean-start-guild-smoke-v1${suffix}.json`), '{"schema":"buildguild.evidence.v1"}\n');
    writeFileSync(join(dir, `raw-lean-start-guild-smoke-v1${suffix}.json`), '{}\n');
    mkdirSync(join(dir, 'evaltmp', 'claude-eval-a', 'out'), { recursive: true });
    writeFileSync(join(dir, 'evaltmp', 'claude-eval-a', 'out', 'trace.jsonl'), '{}\n');
    writeFileSync(join(dir, 'summary'), '');
    const r = spawnSync('bash', ['-e', '-c', lines], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: join(dir, 'summary'), BG_BUILD: 'lean-start', BG_TRIAL: 'guild-smoke-v1', BG_REP: rep, BG_MEASUREMENT: measurement, BG_WHY_NOT: why } });
    assert.equal(r.status, 0, r.stderr);
    const upload = join(dir, 'upload');
    const files = readdirSync(upload, { recursive: true }).filter(f => !f.endsWith('claude-eval-a') && f !== 'traces' && !f.endsWith('out')).sort();
    return { files, note: existsSync(join(upload, 'NOT-A-MEASUREMENT.txt')) ? readFileSync(join(upload, 'NOT-A-MEASUREMENT.txt'), 'utf8') : null, summary: readFileSync(join(dir, 'summary'), 'utf8'), upload };
  };
  const kept = gather('true', '');
  assert.deepEqual(kept.files, ['evidence-lean-start-guild-smoke-v1.json', 'raw-lean-start-guild-smoke-v1.json', 'traces/claude-eval-a/trace.jsonl']);
  assert.equal(kept.note, null);
  assert.equal(kept.summary, '');
  const why = 'This run is not a measurement: the sandbox kept 30 of the 30 shell commands Claude Code tried to run from starting.';
  const renamed = gather('false', why);
  assert.deepEqual(renamed.files, ['NOT-A-MEASUREMENT.txt', 'not-evidence-lean-start-guild-smoke-v1.json', 'raw-lean-start-guild-smoke-v1.json', 'traces/claude-eval-a/trace.jsonl']);
  assert.equal(readFileSync(join(renamed.upload, 'not-evidence-lean-start-guild-smoke-v1.json'), 'utf8'), '{"schema":"buildguild.evidence.v1"}\n');
  assert.equal(renamed.note, `${why}\nNothing in this upload is evidence: these files are for working out what went wrong. Do not submit or import them.\n`);
  assert.match(renamed.summary, /upload as not-evidence-lean-start-guild-smoke-v1, for working out what went wrong only/);
  // A check that never ran is no measurement either, and a repeated run keeps its rep in every name.
  const unchecked = gather('', '', '2');
  assert.deepEqual(unchecked.files, ['NOT-A-MEASUREMENT.txt', 'not-evidence-lean-start-guild-smoke-v1-rep2.json', 'raw-lean-start-guild-smoke-v1-rep2.json', 'traces/claude-eval-a/trace.jsonl']);
  assert.match(unchecked.note, /^This run was never checked for shell commands the sandbox kept from starting\.\n/);
});

test('the workflow header and the README say what each check proves, the rule and its limits, and how to move a pin', () => {
  const header = workflow.slice(0, workflow.indexOf('\non:'));
  const flat = text => text.replace(/\n# ?/g, ' ').replace(/\s+/g, ' ');
  for (const phrase of ['pinned to the ubuntu-24.04 image and to the Claude Code release in .github/scripts/install-trial-tools.sh', "AppArmor's bwrap-userns-restrict profile keeps the sandbox's seccomp helper from starting any command", 'with a stand-in for the model on 127.0.0.1, so no model is asked and nothing is spent', 'both agent runs its trial asks for, one with the build and one without, each ran its Bash call inside the sandbox', "a user namespace other than the runner's", 'not-evidence-<build>-<trial>.json beside NOT-A-MEASUREMENT.txt']) {
    assert.ok(flat(header).includes(phrase), phrase);
  }
  const shells = stepText(SHELLS).replace(/\n {8}# ?/g, ' ').replace(/\s+/g, ' ');
  const text = readme.replace(/\s+/g, ' ');
  // The same rule and the same limits, in the step's comment and in the README.
  for (const where of [shells, text]) {
    for (const phrase of ['error whose text begins "Exit code <n>"', 'a PreToolUse hook refused the call', "the model's input failed validation", 'Claude Code blocked a long sleep', 'nothing but the sandbox wrapper\'s own setup lines', 'not one of them exited 0', 'runs past its timeout', 'can only reject a run, never accept one', 'prints something besides those shapes and hits only some commands is not detected', 'nor is one that hits only commands run in the background', 'A run cut off in the middle of a shell command is rejected']) {
      assert.ok(where.includes(phrase), `${phrase} (${where === shells ? 'workflow' : 'README'})`);
    }
  }
  for (const phrase of ['**Before the key is fetched**', '**After the trial**', 'no model is asked and nothing is spent', 'exactly the two agent runs that trial asks for, one with the build and one without', 'received each call\'s result exactly once, under the call\'s own id', 'A trial whose agents asked for no shell command at all is still a measurement.', 'To move a pin on purpose:', 'The sandbox self-test workflow runs on that pull request at no cost. Merge only if it passes.', 'For a new Claude Code release, also check again how it writes a Bash result, against its source.', 'with each of the three Claude Code releases tried (2.1.309, 2.1.311 and 2.1.322)', 'reads exit status 1 as success for `grep`, `find`, `diff` and `test`']) {
    assert.ok(text.includes(phrase), phrase);
  }
  for (const stale of ['never matches', 'whatever the Claude Code release', 'word for word apart from the reason', 'came back as a success']) {
    assert.ok(!text.includes(stale) && !flat(header).includes(stale) && !shells.includes(stale), stale);
  }
});
