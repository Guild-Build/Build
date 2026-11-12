// The Season trial job's two sandbox checks and the pins behind them. Before the key is fetched, the self-test
// (.github/scripts/sandbox-self-test.mjs) runs the trial's own path with a stand-in for the model
// (.github/scripts/stand-in-api.mjs); after the trial, .github/scripts/shell-starts.mjs decides whether the sandbox
// kept any shell command from starting. Nothing here calls a model or the network: the stand-in and every claude are
// local.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { decide, startStandIn, STAND_IN_KEY } from '../.github/scripts/stand-in-api.mjs';
import { cliArgs, judge, PROBE_COMMAND, selfTest, standInEnv } from '../.github/scripts/sandbox-self-test.mjs';
import { bashCalls, SANDBOX_PREFIXES, stoppedBySandbox, verdict } from '../.github/scripts/shell-starts.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => readFileSync(join(root, rel), 'utf8');
const workflow = read('.github/workflows/trial.yml');
const check = read('.github/workflows/sandbox.yml');
const install = read('.github/scripts/install-trial-tools.sh');
const readme = read('README.md');
const temp = (t, prefix) => { const dir = mkdtempSync(join(tmpdir(), prefix)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

// What the pilot run's Bash tool returned for every one of its 30 shell calls, on ubuntu-26.04 with Claude Code 2.1.322
// (run 43153585543), and what the self-test's command printed inside a working sandbox on ubuntu-24.04 (run
// 43248208194).
const HOME = '/home/runner/work/_temp/evaltmp/claude-eval-1dVSyj/home';
const BASHRC = `/bin/bash: ${HOME}/.bashrc: Permission denied`;
const SECCOMP_HELPER = 'apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied';
const PILOT = `Exit code 1\n${BASHRC}\n${BASHRC}\n${SECCOMP_HELPER}`;
const WORKING = `${BASHRC}\n${BASHRC}\nprobe=42\nseccomp=2\nuserns=user:[4026532282]`;
const HOST = 'user:[4026531837]';

// A trace as Claude Code writes it, one JSON message per line; each call is [tool, input, isError, text].
const trace = calls => calls.flatMap(([tool, input, isError, text], i) => [
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${i}`, name: tool, input }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, content: text, ...(isError ? { is_error: true } : {}) }] } },
]).map(entry => JSON.stringify(entry)).join('\n') + '\n';
const bash = (command, isError, text) => ['Bash', { command }, isError, text];

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

test('the self-test passes only on exit 0 with the expected lines, from inside the sandbox, as the after-trial check reads them', () => {
  const ok = [{ id: 'a', isError: false, text: WORKING }, { id: 'b', isError: false, text: WORKING }];
  assert.deepEqual(judge(ok, { runs: 2, hostUserns: HOST, traced: ok }), { pass: true, problems: [] });
  const fails = (results, options = {}) => {
    const v = judge(results, { runs: results.length, hostUserns: HOST, traced: results, ...options });
    assert.equal(v.pass, false);
    return v.problems.join('\n');
  };
  // The pilot: the sandbox's helper failed, so the command never started.
  assert.match(fails([{ id: 'a', isError: true, text: PILOT }, { id: 'b', isError: true, text: PILOT }]), /result 2: the command did not exit 0; the Bash tool returned .*apply-seccomp/);
  // Run beside the sandbox: the command ran, with no seccomp filter and in the runner's own namespace.
  const beside = fails([{ id: 'a', isError: false, text: `probe=42\nseccomp=0\nuserns=${HOST}` }]);
  assert.match(beside, /no line seccomp=2/);
  assert.match(beside, /in this runner's own user namespace/);
  // A filter in the runner's own namespace, or another namespace with no filter, is not enough on its own.
  assert.match(fails([{ id: 'a', isError: false, text: `probe=42\nseccomp=2\nuserns=${HOST}` }]), /own user namespace/);
  assert.match(fails([{ id: 'a', isError: false, text: 'probe=42\nuserns=user:[7]' }]), /no line seccomp=2/);
  assert.match(fails([{ id: 'a', isError: false, text: 'probe=42\nseccomp=2' }]), /no line userns=/);
  // The shell's own answer, once: the command's text echoed back, or two answers, prove nothing.
  assert.match(fails([{ id: 'a', isError: false, text: `${PROBE_COMMAND}\nseccomp=2\nuserns=user:[7]` }]), /no line probe=42/);
  assert.match(fails([{ id: 'a', isError: false, text: 'probe=42\nprobe=42\nseccomp=2\nuserns=user:[7]' }]), /no line probe=42/);
  // Claude Code's exit line means the command did not exit 0, even on a result not marked as an error.
  assert.match(fails([{ id: 'a', isError: false, text: `Exit code 1\n${WORKING}` }]), /did not exit 0/);
  // One result for every agent run.
  assert.match(fails([{ id: 'a', isError: false, text: WORKING }], { runs: 2 }), /1 Bash result\(s\) came back for 2 agent run\(s\)/);
  assert.match(fails([], { runs: null }), /no agent runs/);
  assert.match(fails([], { runs: 0 }), /no agent runs/);
  // The after-trial check must read the same results from the traces, or it could miss a trial's shell calls.
  assert.match(fails(ok, { traced: [] }), /the after-trial check read 0 Bash result\(s\) from the traces, not the 2/);
  assert.match(fails(ok, { traced: [ok[0], { ...ok[1], isError: true }] }), /the after-trial check read 2 Bash result\(s\) from the traces, not the 2 the Bash tool returned/);
});

test('the self-test command run beside the sandbox, on this machine, fails the self-test', () => {
  const r = spawnSync('bash', ['-c', PROBE_COMMAND], { encoding: 'utf8' });
  assert.match(r.stdout, /^probe=42$/m);
  let host = 'none';
  try { host = readlinkSync('/proc/self/ns/user'); } catch {}
  const result = { id: 'a', isError: r.status !== 0, text: r.stdout + r.stderr };
  assert.equal(judge([result], { runs: 1, hostUserns: host, traced: [result] }).pass, false);
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

// A stub claude for the CLI under the self-test: as `plugin eval` it plays both arms against whatever model API it is
// given, as Claude Code does, but returns STUB_PLAN's result instead of running the command, writes each arm's trace
// (unless told not to) and the raw report, and logs what it was started with.
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
  for (const arm of ['with', 'without']) {
    const ask = { model: 'claude-sonnet-5-5', max_tokens: 9, tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'Run the sandbox self-test command.' }] };
    const call = (await post(ask)).content.find(b => b.type === 'tool_use');
    const result = { type: 'tool_result', tool_use_id: call.id, content: plan.text, ...(plan.isError ? { is_error: true } : {}) };
    const out = join(process.env.TMPDIR, 'claude-eval-' + arm, 'out');
    mkdirSync(out, { recursive: true });
    if (!plan.noTrace) writeFileSync(join(out, 'trace.jsonl'), [{ type: 'assistant', message: { role: 'assistant', content: [call] } }, { type: 'user', message: { role: 'user', content: [result] } }].map(e => JSON.stringify(e)).join('\\n') + '\\n');
    await post({ ...ask, messages: [...ask.messages, { role: 'assistant', content: [call] }, { role: 'user', content: [result] }] });
    arms[arm].push({ score: 1, error: null, tracePath: join(out, 'trace.jsonl') });
  }
  writeFileSync('buildguild-raw.json', JSON.stringify({ claudeVersion: '2.1.322', costUsd: 0, partial: false, cases: [{ name: 'run-one-command', arms, aggregates: { score: 1 } }], aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0 } }));
})();
`;

test('the self-test runs the CLI against the stand-in only, and its verdict follows what the Bash tool returned', async t => {
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
  const good = await run('good', { text: WORKING });
  assert.equal(good.status, 0);
  assert.deepEqual(good.verdict, { pass: true, problems: [] });
  assert.equal(good.results.length, 2);
  // One plugin eval with the trial's flags, which saw only the stand-in, its placeholder key and the self-test's temp
  // folder, although the environment it started from held a real-looking key, header and API address.
  assert.equal(good.calls.length, 1);
  const [call] = good.calls;
  assert.deepEqual(call.args.slice(0, 9), ['plugin', 'eval', '.', '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit', '--json']);
  assert.ok(call.args.includes('--keep-temp') && call.args.includes('--no-publish'));
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
  assert.match(pilot.verdict.problems[0], /^result 1: the command did not exit 0/);
  // A working result the after-trial check cannot find in the traces fails too.
  const untraced = await run('untraced', { text: WORKING, noTrace: true });
  assert.equal(untraced.verdict.pass, false);
  assert.match(untraced.verdict.problems.join('\n'), /the after-trial check read 0 Bash result/);
  // An eval that writes no report: the CLI fails, and so does the self-test.
  const broken = await run('broken', { noReport: true });
  assert.equal(broken.status, 1);
  assert.equal(broken.verdict.pass, false);
  assert.match(broken.verdict.problems[0], /^the CLI ended with exit status 1, not 0/);
});

test('the after-trial rule: a command the sandbox kept from starting, and the failures that are the command\'s own', () => {
  const stopped = [
    PILOT,
    `Exit code 1\n${SECCOMP_HELPER}`,
    'Exit code 1\nbwrap: setting up uid map: Permission denied',
    `Exit code 1\n${BASHRC}\nbwrap: loopback: Failed RTM_NEWADDR: Operation not permitted\n`,
    'Sandbox is required (sandbox.failIfUnavailable) and stopped being available in this session: socat not installed',
    'Sandbox is required but failed to initialize: bubblewrap missing. Restart to retry.',
  ];
  for (const text of stopped) assert.equal(stoppedBySandbox(true, text), true, text);
  const ownFailures = [
    // A test that fails, after the shell's start-up complaints.
    `Exit code 1\n${BASHRC}\n${BASHRC}\nFAIL tests/sum.test.js\n  expected 3, got 4\nTests: 1 failed, 4 passed`,
    // A script that exits 1, with and without a word.
    'Exit code 1',
    `Exit code 1\n${BASHRC}\n${BASHRC}`,
    'Exit code 1\nerror: config.yaml not found',
    // bash's own complaint about the command.
    'Exit code 127\n/bin/bash: line 1: pytest: command not found',
    // A command's own output that mentions the sandbox among other lines.
    'Exit code 1\nchecking the sandbox\nbwrap: No permissions to create a new namespace',
    // The helper's words anywhere but at the start of a line.
    'Exit code 1\nlog: apply-seccomp: write /proc/self/setgroups failed',
  ];
  for (const text of ownFailures) assert.equal(stoppedBySandbox(true, text), false, text);
  // A result that is not an error was a command that ran, whatever it printed.
  assert.equal(stoppedBySandbox(false, SECCOMP_HELPER), false);
  assert.deepEqual(SANDBOX_PREFIXES, ['bwrap: ', 'apply-seccomp: ', 'Sandbox is required']);
});

test('the after-trial verdict: one stopped shell command anywhere, or no trace, means no measurement; the agents\' own failures never do', () => {
  const healthy = {
    'claude-eval-a': trace([
      bash('npm test', true, `Exit code 1\n${BASHRC}\n${BASHRC}\nFAIL tests/sum.test.js\n  expected 3, got 4`),
      bash('ls', false, `${BASHRC}\nREADME.md`),
      ['Read', { file_path: '/x' }, true, SECCOMP_HELPER],
    ]),
    'claude-eval-b': trace([bash('./deploy.sh', true, 'Exit code 1'), bash('pytest', true, 'Exit code 127\n/bin/bash: line 1: pytest: command not found')]),
  };
  const fine = verdict(healthy);
  assert.equal(fine.measurement, true);
  assert.equal(fine.calls, 4);
  assert.equal(fine.sentence, 'The sandbox started every shell command the agents asked for: 4 of 4, across 2 agent run(s).');
  // The pilot: every shell call in every run stopped by the sandbox's helper.
  const pilot = verdict(Object.fromEntries(['p', 'q', 'r'].map((n, i) => [`claude-eval-${n}`, trace(Array.from({ length: i + 1 }, () => bash('git status', true, PILOT)))])));
  assert.equal(pilot.measurement, false);
  assert.equal(pilot.stopped.length, 6);
  assert.equal(pilot.sentence, `This run is not a measurement: the sandbox kept 6 of the 6 shell commands the agents asked for from starting, in 3 of 3 agent run(s), so every grader that needed one of them failed. The first one ended with: ${SECCOMP_HELPER}`);
  // One stopped call among healthy runs is enough.
  const one = verdict({ ...healthy, 'claude-eval-c': trace([bash('ls', false, 'a'), bash('make', true, 'Exit code 1\nbwrap: setting up uid map: Permission denied')]) });
  assert.equal(one.measurement, false);
  assert.match(one.sentence, /kept 1 of the 6 shell commands the agents asked for from starting, in 1 of 3 agent run\(s\)/);
  assert.deepEqual(one.stopped.map(s => [s.trace, s.command]), [['claude-eval-c', 'make']]);
  // No trace at all is no measurement; runs that never asked for a shell command are one.
  assert.deepEqual([verdict({}).measurement, verdict({}).sentence], [false, 'This run is not a measurement: the trial left no agent traces, so nothing shows what its agents did or that their shell commands ran.']);
  const quiet = verdict({ 'claude-eval-a': trace([['Read', { file_path: '/x' }, false, 'text']]) });
  assert.deepEqual([quiet.measurement, quiet.calls], [true, 0]);
  // A trace line that is not JSON is counted and skipped, and the rest is still read.
  const torn = bashCalls(`${trace([bash('ls', false, 'a')])}{"type":"assist`);
  assert.deepEqual([torn.calls.length, torn.unreadable], [1, 1]);
  // Results written as text blocks are read like plain text.
  const blocks = bashCalls(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'c' } }] } }) + '\n' + JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{ type: 'text', text: 'Exit code 1' }, { type: 'text', text: SECCOMP_HELPER }] }] } }));
  assert.equal(blocks.calls[0].stopped, true);
});

test('the after-trial check fails the job and says why in its log, the job summary and the step outputs', t => {
  const dir = temp(t, 'bg-shell-starts-');
  const runIn = traces => {
    const folder = mkdtempSync(join(dir, 'evaltmp-'));
    for (const [name, text] of Object.entries(traces)) { mkdirSync(join(folder, name, 'out'), { recursive: true }); writeFileSync(join(folder, name, 'out', 'trace.jsonl'), text); }
    writeFileSync(join(folder, 'output'), '');
    writeFileSync(join(folder, 'summary'), '');
    const r = spawnSync(process.execPath, [join(root, '.github/scripts/shell-starts.mjs'), folder], { encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_OUTPUT: join(folder, 'output'), GITHUB_STEP_SUMMARY: join(folder, 'summary') } });
    return { ...r, output: readFileSync(join(folder, 'output'), 'utf8'), summary: readFileSync(join(folder, 'summary'), 'utf8') };
  };
  const bad = runIn({ 'claude-eval-a': trace([bash('ls', true, `Exit code 1\nbwrap: odd\rline`)]) });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^::error::This run is not a measurement: /m);
  assert.match(bad.summary, /^### Not a measurement\n\nThis run is not a measurement: the sandbox kept 1 of the 1 /);
  // Two output lines, whatever the trace held: the carriage return in the sandbox's line is dropped.
  assert.deepEqual(bad.output.split('\n'), ['measurement=false', 'sentence=This run is not a measurement: the sandbox kept 1 of the 1 shell commands the agents asked for from starting, in 1 of 1 agent run(s), so every grader that needed one of them failed. The first one ended with: bwrap: oddline', '']);
  const good = runIn({ 'claude-eval-a': trace([bash('npm test', true, 'Exit code 1\nFAIL')]) });
  assert.equal(good.status, 0);
  assert.equal(good.output.split('\n')[0], 'measurement=true');
  assert.doesNotMatch(good.summary, /Not a measurement/);
  const none = runIn({});
  assert.equal(none.status, 1);
  assert.equal(none.output.split('\n')[0], 'measurement=false');
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

test('the self-test runs before Azure and the key, and the shell check after the trial and before anything is gathered', () => {
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
  // from.
  const shells = stepText(SHELLS);
  assert.match(shells, /\n {8}id: shells\n {8}if: \$\{\{ always\(\) && matrix\.verify_only != 'true' && steps\.run\.outcome != 'skipped' \}\}\n/);
  assert.match(shells, /\n {8}run: node \.github\/scripts\/shell-starts\.mjs "\$RUNNER_TEMP\/evaltmp"\n/);
  assert.match(stepText('Run the trial'), /\n {8}id: run\n/);
  assert.match(runLines('Run the trial'), /^mkdir -p "\$RUNNER_TEMP\/evaltmp" && export TMPDIR="\$RUNNER_TEMP\/evaltmp"$/m);
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
  const why = 'This run is not a measurement: the sandbox kept 30 of the 30 shell commands the agents asked for from starting.';
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

test('the workflow header and the README say what the self-test proves, what the after-trial rule does and how to move a pin', () => {
  const header = workflow.slice(0, workflow.indexOf('\non:'));
  const flat = text => text.replace(/\n# ?/g, ' ').replace(/\s+/g, ' ');
  for (const phrase of ['pinned to the ubuntu-24.04 image and to the Claude Code release in .github/scripts/install-trial-tools.sh', "AppArmor's bwrap-userns-restrict profile keeps the sandbox's seccomp helper from starting any command", 'with a stand-in for the model on 127.0.0.1, so no model is asked and nothing is spent', "It passes only when every agent run's Bash call exited 0 inside the sandbox", 'a user namespace other than the runner\'s', 'If the sandbox kept any shell command from starting, or no trace was left, the run is not a measurement', 'not-evidence-<build>-<trial>.json beside NOT-A-MEASUREMENT.txt']) {
    assert.ok(flat(header).includes(phrase), phrase);
  }
  const text = readme.replace(/\s+/g, ' ');
  for (const phrase of ['**Before the key is fetched**', '**After the trial**', 'no model is asked and nothing is spent', 'a failing test or a script that exits 1 never matches', 'To move a pin on purpose:', 'The sandbox self-test workflow runs on that pull request at no cost. Merge only if it passes.', 'needs its `bwrap-userns-restrict` profile out of the way, which is a change to the runner\'s security settings']) {
    assert.ok(text.includes(phrase), phrase);
  }
  // The README names the same three prefixes the rule uses.
  for (const prefix of SANDBOX_PREFIXES) assert.ok(text.includes(`\`${prefix}\``), prefix);
});
