// After the trial: did the sandbox start every shell command Claude Code tried to run for the agents, and can the
// traces show it? It reads the eval's raw report and every agent trace the eval kept. A run is not a measurement when:
//  (a) the report and the traces are not complete or do not match. The report must read and list agent runs, each
//      naming a trace of its own: no run names none, no trace is named twice or missing, every trace found belongs to a
//      listed run, and no two run folders hold one trace file (a symbolic or hard link, found by resolved path and by
//      device and inode). Each trace must be complete (completeness() below): (1) every line is a JSON object, a blank
//      line counting against it and only the file's one terminating newline allowed, and there is at least one; (2) it
//      ends with Claude Code's final result event, closes every turn it opened with one result event and saw every
//      background task it started (a command run in the background, a subagent) report its end, so a trace that stops
//      before that, for any reason including the eval's own time limit, is not complete; a run that uses a subagent or
//      a background command is fine when its trace shows all of it; (3) every tool request in it, of any tool, has
//      exactly one result in it, and every tool result in it answers a request in it; and (4) across all the traces of
//      the job, no tool request id and no tool result id appears more than once. A complete trace with no shell request
//      in it is fine;
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
//      command was not interrupted, and holds neither. A subagent's Bash results carry no record in the parent's trace,
//      so they never count.
// The limits: (c) also counts a command that started and printed nothing but such lines, which can only reject a run.
// A wrapper failure that exits with a status, prints something besides those shapes and hits only some commands is
// not detected here, and neither is one that hits a command run in the background, whose exit comes later, outside its
// Bash result. The self-test before the key and the pins guard against those.
// The scope: this check and the self-test guard against a fault in the environment, such as a runner image, a tool
// release, a bridge or a crash that keeps shell commands from starting or leaves the report or traces cut short, missing
// or unreadable. They are no defence against someone who can write the eval's own report and trace files, who could
// write the grades too, so a forged record, one no Claude Code release writes, is out of their scope.
//
// Usage: node .github/scripts/shell-starts.mjs <folder holding claude-eval-*/out/trace.jsonl> <the eval's raw report>
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
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

// The events of one trace, one JSON object per line; `unreadable` counts the lines that are not one, a blank or
// whitespace-only line included, and `last` is the last line's event, or null when that line is not one. Only the
// file's one terminating newline is allowed besides the events.
function eventsOf(trace) {
  const events = [];
  let unreadable = 0;
  let last = null;
  const lines = trace.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    let event = null;
    try { event = JSON.parse(line); } catch {}
    if (event === null || typeof event !== 'object' || Array.isArray(event)) { unreadable++; last = null; continue; }
    events.push(event);
    last = event;
  }
  return { events, unreadable, last };
}
const blocksOf = (event, type) => (Array.isArray(event.message?.content) ? event.message.content : []).filter(b => b?.type === type);
const isId = id => typeof id === 'string' && id !== '';

// Rule (a): whether one trace is complete. It is complete only when (1) every line is a JSON object, a blank or
// whitespace-only line counting against it and only the file's one terminating newline allowed, and there is at least
// one; (2) its last event is a result event, it closes each turn it opened (a system init event) with one result event,
// in order, the init before its result, their result_index running 0, 1, … with no gap or repeat, and every background
// task it started (task_started) reported its end (task_notification) in it, each exactly once, by task_id; and (3)
// every tool request in it, of any tool, has exactly one result in it, and every tool result in it answers a request in
// it. Part (4), that no tool request id and no tool result id appears more than once across all the traces of the job,
// needs them all: verdict() checks it on the ids this returns. A result event with no result_index, or a task event
// with no task_id, fails part (2).
export function completeness(trace) {
  const { events, unreadable, last } = eventsOf(trace);
  // A request with no id can never be answered, and a result with no id answers nothing.
  const requests = events.flatMap(e => (e.type === 'assistant' ? blocksOf(e, 'tool_use') : []).map(b => b.id));
  const results = events.flatMap(e => (e.type === 'user' ? blocksOf(e, 'tool_result') : []).map(b => b.tool_use_id));
  const requestIds = requests.filter(isId);
  const resultIds = results.filter(isId);
  const answers = id => resultIds.filter(r => r === id).length;
  // Claude Code 2.1.322 opens a turn with a system init event and closes it with a result event. A command run in the
  // background, or a subagent, reports its start and its end, and its end opens one more turn.
  const turns = events.flatMap((e, at) => (e.type === 'system' && e.subtype === 'init' ? [at] : []));
  const finals = events.flatMap((e, at) => (e.type === 'result' ? [{ at, index: e.result_index }] : []));
  const tasks = subtype => events.filter(e => e.type === 'system' && e.subtype === subtype).map(e => e.task_id);
  const started = tasks('task_started');
  const ended = tasks('task_notification');
  const times = (list, id) => list.filter(x => x === id).length;
  return {
    empty: events.length === 0 && unreadable === 0,
    unreadable,
    endsWithFinal: last?.type === 'result',
    turnsClosed: turns.length === finals.length && finals.every((f, k) => f.index === k && turns[k] < f.at),
    unpairedTasks: [...new Set([...started, ...ended])].filter(id => !isId(id) || times(started, id) !== 1 || times(ended, id) !== 1).length,
    unanswered: requests.filter(id => !isId(id) || answers(id) === 0).length,
    answeredTwice: [...new Set(requestIds)].filter(id => answers(id) > 1).length,
    orphans: results.filter(id => !isId(id) || !requestIds.includes(id)).length,
    repeatedRequests: [...new Set(requestIds)].filter(id => requestIds.indexOf(id) !== requestIds.lastIndexOf(id)).length,
    requestIds,
    resultIds,
  };
}

// What keeps one trace from being complete, part by part with counts; empty when it is complete.
export function gaps(c) {
  return [
    c.empty && 'the file is empty',
    c.unreadable && `${plural(c.unreadable, 'line')} that ${c.unreadable === 1 ? 'is' : 'are'} not a JSON object`,
    !c.empty && !c.endsWithFinal && "it does not end with Claude Code's final result event",
    !c.turnsClosed && 'its result events do not close the turns it opened one for one, numbered from 0 in order',
    c.unpairedTasks && `${plural(c.unpairedTasks, 'background task')} without exactly one start and one end`,
    c.unanswered && `${plural(c.unanswered, 'tool request')} with no result`,
    c.answeredTwice && `${plural(c.answeredTwice, 'tool request')} answered more than once`,
    c.orphans && `${plural(c.orphans, 'tool result')} answering no request in the trace`,
    c.repeatedRequests && `${plural(c.repeatedRequests, 'tool request id')} used more than once`,
  ].filter(Boolean);
}

// Every Bash request in one trace with its first result: { id, command, isError, text, meta, kind, exitedZero }. A
// request with no result or more than one, and a result with no request, are rule (a)'s, through completeness().
export function bashCalls(trace) {
  const { events } = eventsOf(trace);
  const commands = new Map();
  for (const e of events) {
    for (const b of e.type === 'assistant' ? blocksOf(e, 'tool_use') : []) {
      if (b.name === 'Bash' && isId(b.id) && !commands.has(b.id)) commands.set(b.id, String(b.input?.command ?? ''));
    }
  }
  const calls = new Map();
  for (const e of events) {
    const blocks = e.type === 'user' ? blocksOf(e, 'tool_result') : [];
    // Claude Code writes each result on a line of its own, with its record beside it; on a line holding more than one
    // result, the record cannot be told apart, so it counts for none of them.
    const record = blocks.length === 1 ? e.tool_use_result : undefined;
    for (const b of blocks) {
      if (!commands.has(b.tool_use_id) || calls.has(b.tool_use_id)) continue;
      const meta = Array.isArray(e.tool_result_meta) ? e.tool_result_meta.find(m => m?.id === b.tool_use_id) : undefined;
      const call = { id: b.tool_use_id, command: commands.get(b.tool_use_id), isError: b.is_error === true, text: textOf(b), meta };
      call.kind = kindOf(call.isError, call.text, meta);
      call.exitedZero = exitZero(call.kind, record);
      calls.set(b.tool_use_id, call);
    }
  }
  return { calls: [...calls.values()] };
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
// to its trace text (null for a trace file that could not be opened); `raw` is the parsed raw report, or null; `linked`
// lists the run folders whose trace is one file with another folder's (sameFiles).
export function verdict(traces, raw, linked = []) {
  const names = Object.keys(traces).sort();
  const runs = raw ? runsIn(raw) : null;
  const unopened = names.filter(name => traces[name] === null);
  const read = names.filter(name => traces[name] !== null).map(name => ({ name, c: completeness(traces[name]) }));
  const calls = read.flatMap(({ name }) => bashCalls(traces[name]).calls.map(c => ({ trace: name, ...c })));
  const total = key => read.reduce((n, { c }) => n + c[key], 0);
  const count = test => read.filter(({ c }) => test(c)).length;
  // Part (4): ids that appear more than once across all the traces, a trace's own repeats included.
  const repeats = key => {
    const seen = new Map();
    for (const { c } of read) for (const id of c[key]) seen.set(id, (seen.get(id) ?? 0) + 1);
    return [...seen.values()].filter(n => n > 1).length;
  };
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
  if (linked.length) reasons.push(`${linked.length} run folders share their trace file with another through a link, so some run left no trace of its own`);
  // Each trace must be complete (completeness): parts (1) to (3) trace by trace, then part (4) across them all.
  const empty = count(c => c.empty);
  if (empty) reasons.push(`${plural(empty, 'trace file')} ${empty === 1 ? 'was' : 'were'} empty`);
  if (unopened.length) reasons.push(`${plural(unopened.length, 'trace file')} could not be opened`);
  const unreadable = total('unreadable');
  if (unreadable) reasons.push(`${plural(unreadable, 'trace line')} could not be read`);
  const cutShort = count(c => !c.empty && !c.endsWithFinal);
  if (cutShort) reasons.push(`${plural(cutShort, 'trace')} ${cutShort === 1 ? 'does' : 'do'} not end with Claude Code's final result event, as when a run is cut off, crashes or loses the end of its trace`);
  const unclosed = count(c => !c.turnsClosed);
  if (unclosed) reasons.push(`${plural(unclosed, 'trace')} ${unclosed === 1 ? 'does' : 'do'} not close each turn ${unclosed === 1 ? 'it' : 'they'} opened with one result event, numbered from 0 in order`);
  const unpaired = total('unpairedTasks');
  if (unpaired) reasons.push(`${plural(unpaired, 'background task')} ${unpaired === 1 ? 'does' : 'do'} not report one start and one end in ${unpaired === 1 ? 'its' : 'their'} trace, as when a run is cut off while a task still runs`);
  const unanswered = total('unanswered');
  if (unanswered) reasons.push(`${plural(unanswered, 'tool request')} got no result in ${unanswered === 1 ? 'its' : 'their'} trace, as when a run is cut off in the middle of a tool call`);
  const twice = total('answeredTwice');
  if (twice) reasons.push(`${plural(twice, 'tool request')} got more than one result`);
  const orphans = total('orphans');
  if (orphans) reasons.push(`${plural(orphans, 'tool result')} ${orphans === 1 ? 'answers' : 'answer'} no request in ${orphans === 1 ? 'its' : 'their'} trace`);
  const requestRepeats = repeats('requestIds');
  if (requestRepeats) reasons.push(`${plural(requestRepeats, 'tool request id')} ${requestRepeats === 1 ? 'appears' : 'appear'} more than once across the traces`);
  const resultRepeats = repeats('resultIds');
  if (resultRepeats) reasons.push(`${plural(resultRepeats, 'tool result id')} ${resultRepeats === 1 ? 'appears' : 'appear'} more than once across the traces`);
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
  return { measurement, sentence, calls, stopped, notAnExit };
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

// The run folders under `dir`, among `names`, whose trace file is also another's: a symbolic or hard link to it, or a
// link to its folder. Each file is known by its resolved path and by its device and inode.
export function sameFiles(dir, names) {
  const owner = new Map();
  const same = new Set();
  for (const name of names) {
    const path = join(dir, name, 'out', 'trace.jsonl');
    let keys;
    try { const st = statSync(path); keys = [`path ${realpathSync(path)}`, `inode ${st.dev}:${st.ino}`]; } catch { continue; }
    for (const key of keys) {
      if (owner.has(key)) { same.add(owner.get(key)); same.add(name); } else owner.set(key, name);
    }
  }
  return [...same].sort();
}

// The raw report at `path`, parsed, or null when it is missing or not JSON.
export function readReport(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function main() {
  const [dir, rawPath] = process.argv.slice(2);
  if (!dir || !rawPath) { console.error('usage: node .github/scripts/shell-starts.mjs <folder holding claude-eval-*/out/trace.jsonl> <the eval\'s raw report>'); process.exit(2); }
  const traces = tracesIn(resolve(dir));
  const v = verdict(traces, readReport(resolve(rawPath)), sameFiles(resolve(dir), Object.keys(traces)));
  console.log(v.sentence);
  for (const c of [...v.notAnExit, ...v.stopped].slice(0, 10)) console.log(`  ${c.kind}, ${c.trace}: ${JSON.stringify(c.command).slice(0, 160)} -> ${JSON.stringify(c.text).slice(0, 300)}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${v.measurement ? '' : '### Not a measurement\n\n'}${v.sentence}\n\n`);
  // One line each, whatever a trace held: control characters, line breaks included, are dropped.
  const oneLine = [...v.sentence].filter(ch => ch.charCodeAt(0) >= 32).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `measurement=${v.measurement ? 'true' : 'false'}\nsentence=${oneLine}\n`);
  if (!v.measurement) { console.log(`::error::${oneLine}`); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
