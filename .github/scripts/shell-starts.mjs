// After the trial: did the sandbox start every shell command Claude Code tried to run for the agents, and can the
// traces show it? It reads the eval's raw report and every agent trace the eval kept. A run is not a measurement when:
//  (a) the report or the traces are incomplete or do not match: the report is missing, unreadable or lists no agent
//      run; a listed run names no trace, or a trace another run also names; a named trace was not found, or a trace
//      found belongs to no listed run; a trace file is empty, cannot be opened or holds a line that is not a JSON
//      object; or a Bash request has no result;
//  (b) a Bash result is an error that is not a process exit, meaning Claude Code returned an error for the call without
//      the command running to an exit status. In Claude Code 2.1.322 a shell command that ran and exited non-zero is
//      the one error whose text begins "Exit code <n>" (its ShellError, written so by the tool dispatcher's error
//      formatter). Every other error is not a process exit: Claude Code's own refusals, its sandbox bridge errors,
//      and anything else, whatever its wording. Three ordinary refusals are allowed, because Claude Code makes them
//      before it tries to run the command: a PreToolUse hook refused the call (the result's tool_result_meta says
//      permission_decision reject, source hook), the model's input failed validation (the text begins
//      "<tool_use_error>InputValidationError: "), or Claude Code blocked a long sleep (the text begins
//      "<tool_use_error>Blocked: " and says "To wait for a condition, use Monitor with an until-loop");
//  (c) a Bash result is a process exit whose output is nothing but the sandbox wrapper's own setup lines: one or more
//      lines shaped like bubblewrap's "bwrap: <message>" or the seccomp helper's "apply-seccomp: <step>: <error>", and
//      otherwise only bash's own complaints. A result counts whether Claude Code marked it an error or not, since it
//      reads exit status 1 as success for grep, find, diff and test;
//  (d) Claude Code tried to run at least one shell command for the agents and not one of them exited 0. A result
//      Claude Code did not mark an error is not always an exit 0: it also reads exit status 1 as success for grep,
//      find, diff, test and a few more, and it answers at once for a command it runs in the background, as it does
//      when a command runs past its timeout. Its own record of the result, the trace line's tool_use_result, says so
//      with returnCodeInterpretation or backgroundTaskId, so a call exited 0 only when that record is there, says the
//      command was not interrupted, and holds neither.
// The limits: (c) also counts a command that started and printed nothing but such lines, which can only reject a run.
// A wrapper failure that exits with a status, prints something besides those shapes and hits only some commands is
// not detected here, and neither is one that hits a command run in the background, whose exit comes later, outside its
// Bash result. The self-test before the key and the pins guard against those.
//
// Usage: node .github/scripts/shell-starts.mjs <folder holding claude-eval-*/out/trace.jsonl> <the eval's raw report>
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The text Claude Code gives a shell command that ran and exited non-zero: "Exit code <n>", then its output.
const EXIT = /^Exit code -?\d+(?:\n|$)/;
// bubblewrap prints every warning and fatal error as "bwrap: <message>" (warnv in its utils.c), and the seccomp helper
// ends on a failed step with perror("apply-seccomp: <step>"), which prints "apply-seccomp: <step>: <error>".
export const SETUP_LINES = [/^bwrap: \S/, /^apply-seccomp: .+: \S/];
const BASH_LINE = /^(?:(?:\/usr)?\/bin\/)?bash: /;
const isSetupLine = line => SETUP_LINES.some(pattern => pattern.test(line));
// The errors that are not a process exit but are allowed: refusals Claude Code makes before it tries to run the
// command.
export const ALLOWED_REFUSALS = [
  { reason: 'a PreToolUse hook refused it', test: (text, meta) => meta?.permission_decision?.decision === 'reject' && meta.permission_decision.source === 'hook' },
  { reason: "the model's input failed validation", test: text => text.startsWith('<tool_use_error>InputValidationError: ') },
  { reason: 'Claude Code blocked a long sleep', test: text => text.startsWith('<tool_use_error>Blocked: ') && text.includes('. To wait for a condition, use Monitor with an until-loop') },
];

// What one Bash result shows: 'success', 'failed' (the command exited non-zero), 'stopped' (rule c), 'refused' (an
// allowed refusal, before Claude Code tried to run it) or 'not-an-exit' (rule b). `meta` is the result's entry in
// tool_result_meta, if any.
export function kindOf(isError, text, meta) {
  if (isError && !EXIT.test(text)) return ALLOWED_REFUSALS.some(a => a.test(text, meta)) ? 'refused' : 'not-an-exit';
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
  const output = isError ? lines.slice(1) : lines;
  if (output.some(isSetupLine) && output.every(l => isSetupLine(l) || BASH_LINE.test(l))) return 'stopped';
  return isError ? 'failed' : 'success';
}

// Whether a result shows an exit 0: a success (not stopped) whose record, Claude Code's tool_use_result, says the
// command was not interrupted, its exit status was not read as success (returnCodeInterpretation), and it was not
// moved to the background (backgroundTaskId).
const exitZero = (kind, record) => kind === 'success' && record !== null && typeof record === 'object' && record.interrupted === false && record.returnCodeInterpretation === undefined && record.backgroundTaskId === undefined;

// The text of a tool result, which Claude Code writes as a string or as a list of text blocks.
const textOf = block => typeof block.content === 'string' ? block.content
  : Array.isArray(block.content) ? block.content.map(b => (b && b.type === 'text' ? b.text : '')).join('\n') : '';

// One trace, JSON lines: every Bash request with its result ({ id, command, isError, text, kind, exitedZero }), the
// requests with no result anywhere in the trace, how many non-blank lines are not a JSON object, and whether the trace
// is empty. A request answered more than once is judged on its first result and on every later one: the worst kind
// wins, and it exited 0 only if every one of its results says so.
const WORST = ['success', 'failed', 'refused', 'stopped', 'not-an-exit'];
export function bashCalls(trace) {
  const entries = [];
  let unreadable = 0;
  for (const line of trace.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { unreadable++; continue; }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { unreadable++; continue; }
    entries.push(entry);
  }
  const requests = new Map();
  for (const e of entries) {
    for (const b of e.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b?.type === 'tool_use' && b.name === 'Bash' && !requests.has(b.id)) requests.set(b.id, String(b.input?.command ?? ''));
    }
  }
  const results = new Map();
  for (const e of entries) {
    const blocks = (e.type === 'user' && Array.isArray(e.message?.content) ? e.message.content : []).filter(b => b?.type === 'tool_result');
    // Claude Code writes each result on a line of its own, with its record beside it; on a line holding more than one
    // result, the record cannot be told apart, so it counts for none of them.
    const record = blocks.length === 1 ? e.tool_use_result : undefined;
    for (const b of blocks) {
      if (!requests.has(b.tool_use_id)) continue;
      const meta = Array.isArray(e.tool_result_meta) ? e.tool_result_meta.find(m => m?.id === b.tool_use_id) : undefined;
      const call = { id: b.tool_use_id, command: requests.get(b.tool_use_id), isError: b.is_error === true, text: textOf(b), meta };
      call.kind = kindOf(call.isError, call.text, meta);
      call.exitedZero = exitZero(call.kind, record);
      const seen = results.get(b.tool_use_id);
      if (seen) seen.exitedZero = call.exitedZero = seen.exitedZero && call.exitedZero;
      if (!seen || WORST.indexOf(call.kind) > WORST.indexOf(seen.kind)) results.set(b.tool_use_id, call);
    }
  }
  const unanswered = [...requests].filter(([id]) => !results.has(id)).map(([id, command]) => ({ id, command }));
  return { calls: [...results.values()], unanswered, unreadable, empty: entries.length === 0 && unreadable === 0 };
}

// How an agent run is named in messages: its case, and whether it ran with the build or without it (the eval's two
// arms).
export const runName = (caseName, arm) => `${caseName}, ${arm === 'with' ? 'with the build' : 'without the build'}`;

// The agent runs a raw report lists, each with the name of the folder its trace is in (claude-eval-…), or null.
export function runsIn(raw) {
  return (Array.isArray(raw?.cases) ? raw.cases : []).flatMap(c => ['with', 'without'].flatMap(arm => (Array.isArray(c?.arms?.[arm]) ? c.arms[arm] : []).map(run => ({
    name: runName(c?.name, arm),
    trace: typeof run?.tracePath === 'string' && basename(run.tracePath) === 'trace.jsonl' && basename(dirname(run.tracePath)) === 'out' ? basename(dirname(dirname(run.tracePath))) : null,
  }))));
}

// How the report's runs and the traces found pair up, one trace to one run: the runs that name no trace, the traces
// named by more than one run, the named traces not found, and the traces found that no run names.
export function pairing(runs, names) {
  const uses = new Map();
  for (const r of runs) if (r.trace !== null) uses.set(r.trace, (uses.get(r.trace) ?? 0) + 1);
  return {
    unnamed: runs.filter(r => r.trace === null).length,
    shared: [...uses].filter(([, n]) => n > 1).map(([t]) => t),
    missing: [...uses.keys()].filter(t => !names.includes(t)),
    extra: names.filter(n => !uses.has(n)),
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstLine = text => text.trim().split('\n')[0];

// The verdict: { measurement, sentence, calls, stopped, notAnExit, unanswered, ... }. `traces` maps a run folder name
// to its trace text (null for a trace file that could not be opened); `raw` is the parsed raw report, or null.
export function verdict(traces, raw) {
  const names = Object.keys(traces).sort();
  const runs = raw ? runsIn(raw) : null;
  const calls = [];
  const unanswered = [];
  const empty = [];
  const unopened = [];
  let unreadable = 0;
  for (const name of names) {
    if (traces[name] === null) { unopened.push(name); continue; }
    const read = bashCalls(traces[name]);
    if (read.empty) empty.push(name);
    unreadable += read.unreadable;
    calls.push(...read.calls.map(c => ({ trace: name, ...c })));
    unanswered.push(...read.unanswered.map(u => ({ trace: name, ...u })));
  }
  const of = kind => calls.filter(c => c.kind === kind);
  const stopped = of('stopped');
  const notAnExit = of('not-an-exit');
  const tried = calls.filter(c => c.kind !== 'refused');
  const exited = calls.filter(c => c.exitedZero).length;
  const reasons = [];
  // (a)
  if (!raw) reasons.push('the eval left no readable report of its agent runs, so nothing shows that each one left its trace');
  else if (!runs.length) reasons.push("the eval's report lists no agent runs");
  else {
    const p = pairing(runs, names);
    if (p.unnamed) reasons.push(`${plural(p.unnamed, 'agent run')} in the eval's report ${p.unnamed === 1 ? 'names' : 'name'} no trace`);
    if (p.shared.length) reasons.push(`${plural(p.shared.length, 'trace')} ${p.shared.length === 1 ? 'is' : 'are'} named by more than one agent run in the eval's report, so some run left no trace of its own`);
    if (p.missing.length) reasons.push(`${plural(p.missing.length, 'trace')} the eval's report names ${p.missing.length === 1 ? 'was' : 'were'} not found`);
    if (p.extra.length) reasons.push(`${plural(p.extra.length, 'trace')} found ${p.extra.length === 1 ? 'belongs' : 'belong'} to no agent run in the eval's report`);
  }
  if (empty.length) reasons.push(`${plural(empty.length, 'trace file')} ${empty.length === 1 ? 'was' : 'were'} empty`);
  if (unopened.length) reasons.push(`${plural(unopened.length, 'trace file')} could not be opened`);
  if (unreadable) reasons.push(`${plural(unreadable, 'trace line')} could not be read`);
  if (unanswered.length) reasons.push(`${plural(unanswered.length, 'shell command')} the agents asked for got no result in the trace, as when a run is cut off in the middle of a command`);
  // (b)
  if (notAnExit.length) reasons.push(`${plural(notAnExit.length, 'shell command')} ended in an error from Claude Code instead of an exit of the command (the first: ${firstLine(notAnExit[0].text)})`);
  // (c)
  if (stopped.length) {
    const first = stopped[0].text.split('\n').map(l => l.trim()).find(isSetupLine);
    reasons.push(`the sandbox kept ${stopped.length} of the ${tried.length} shell commands Claude Code tried to run from starting, in ${new Set(stopped.map(s => s.trace)).size} of ${plural(names.length, 'agent run')}, so every grader that needed one of them failed (the first ended with: ${first})`);
  }
  // (d)
  if (tried.length && !exited) reasons.push(`Claude Code tried to run ${plural(tried.length, 'shell command')} for the agents and not one exited 0`);
  const measurement = reasons.length === 0;
  const refused = of('refused').length;
  const shells = tried.length ? `none of the ${plural(tried.length, 'shell command')} Claude Code tried to run for the agents was kept from starting or ended in an error from Claude Code, and ${exited} exited 0` : 'Claude Code tried to run no shell command for the agents';
  const sentence = measurement
    ? `No result shows the sandbox keeping a command from starting: ${shells}${refused ? ` (${plural(refused, 'other')} ${refused === 1 ? 'was' : 'were'} refused before running, by a hook or an input check)` : ''}; each of the ${plural(runs.length, 'agent run')} in the eval's report left its own complete trace.`
    : `This run is not a measurement: ${reasons.join('; ')}.`;
  return { measurement, sentence, calls, stopped, notAnExit, unanswered, unreadable, empty, unopened };
}

// The traces under a folder of kept eval runs, keyed by run folder name; a trace file that cannot be read maps to null.
export function tracesIn(dir) {
  if (!existsSync(dir)) return {};
  const traces = {};
  for (const name of readdirSync(dir).filter(n => n.startsWith('claude-eval-')).sort()) {
    const path = join(dir, name, 'out', 'trace.jsonl');
    if (!existsSync(path)) continue;
    try { traces[name] = readFileSync(path, 'utf8'); } catch { traces[name] = null; }
  }
  return traces;
}

// The raw report at `path`, parsed, or null when it is missing or not JSON.
export function readReport(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function main() {
  const [dir, rawPath] = process.argv.slice(2);
  if (!dir || !rawPath) { console.error('usage: node .github/scripts/shell-starts.mjs <folder holding claude-eval-*/out/trace.jsonl> <the eval\'s raw report>'); process.exit(2); }
  const v = verdict(tracesIn(resolve(dir)), readReport(resolve(rawPath)));
  console.log(v.sentence);
  for (const c of [...v.notAnExit, ...v.stopped].slice(0, 10)) console.log(`  ${c.kind}, ${c.trace}: ${JSON.stringify(c.command).slice(0, 160)} -> ${JSON.stringify(c.text).slice(0, 300)}`);
  for (const u of v.unanswered.slice(0, 10)) console.log(`  no result, ${u.trace}: ${JSON.stringify(u.command).slice(0, 160)}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${v.measurement ? '' : '### Not a measurement\n\n'}${v.sentence}\n\n`);
  // One line each, whatever a trace held: control characters, line breaks included, are dropped.
  const oneLine = [...v.sentence].filter(ch => ch.charCodeAt(0) >= 32).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `measurement=${v.measurement ? 'true' : 'false'}\nsentence=${oneLine}\n`);
  if (!v.measurement) { console.log(`::error::${oneLine}`); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
