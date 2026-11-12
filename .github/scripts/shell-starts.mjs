// After the trial: did the sandbox start every shell command the agents asked for, and can the traces show it? The
// check reads the eval's raw report and every agent trace the eval kept, and calls the run a measurement only on
// positive evidence for every Bash request: every agent run the report lists left a trace, every trace reads in full,
// every Bash request has its result, and no result shows the sandbox keeping the command from starting. A trial whose
// agents asked for no shell command at all is still a measurement.
//
// A Bash result shows the sandbox kept its command from starting when the Bash tool returned an error and either
//  - its output holds one of Claude Code's own refusals of a command for a sandbox reason, word for word except the
//    reason it names (REFUSALS below, from Claude Code 2.1.321's bundled source; checked against the pinned release by
//    the sandbox experiment), or
//  - its output, after Claude Code's "Exit code N" line, holds at least one line of the shape bubblewrap or the
//    sandbox's seccomp helper prints when it cannot set up ("bwrap: <message>", or "apply-seccomp: <step>: <error>"),
//    and nothing else but bash's own complaints (lines that begin "bash: ", "/bin/bash: " or "/usr/bin/bash: ").
// Those lines come before the command exists: bubblewrap and the helper print one and exit when they cannot set up. A
// command that started prints its own output instead. The limit is real: a command that started, failed and printed
// nothing but lines of those two shapes, plus bash's own complaints, is counted as stopped too. That can only reject a
// run, never accept one.
//
// Usage: node .github/scripts/shell-starts.mjs <folder holding claude-eval-*/out/trace.jsonl> <the eval's raw report>
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// bubblewrap prints every warning and fatal error as "bwrap: <message>" (warnv in its utils.c), and the seccomp helper
// ends on a failed step with perror("apply-seccomp: <step>"), which prints "apply-seccomp: <step>: <error>".
export const SETUP_LINES = [/^bwrap: \S/, /^apply-seccomp: .+: \S/];
// Claude Code's refusals of a command for a sandbox reason, as its bundled source writes them; the reason it names
// (between "initialize" or "session:" and the next full stop) varies and may span lines.
export const REFUSALS = [
  /Sandbox is required \(sandbox\.failIfUnavailable\) and stopped being available in this session: [\s\S]+?\. The command was refused, and so is a request to run it outside the sandbox \(dangerouslyDisableSandbox\): do not retry it that way\./,
  /Sandbox is required but failed to initialize(?:: [\s\S]+?)?\. (?:Fix the sandbox settings to retry \(a --settings file is pinned for the process: restart\)\.|Restart to retry\.) Running it outside the sandbox \(dangerouslyDisableSandbox\) is not allowed either\./,
  /Sandbox is enabled but failed to initialize(?:: [\s\S]+?)?\. Until the sandbox can start, commands that would run in it are refused\./,
  /Sandbox is enabled but failed to initialize(?:: [\s\S]+?)?\. Sandboxing is disabled for the rest of this session; restart to retry\./,
];
const BASH_LINE = /^(?:(?:\/usr)?\/bin\/)?bash: /;
const EXIT_LINE = /^Exit code -?\d+$/;
const isSetupLine = line => SETUP_LINES.some(pattern => pattern.test(line));

// The text of a tool result, which Claude Code writes as a string or as a list of text blocks.
const textOf = block => typeof block.content === 'string' ? block.content
  : Array.isArray(block.content) ? block.content.map(b => (b && b.type === 'text' ? b.text : '')).join('\n') : '';

// True when this Bash result shows that the sandbox kept the command from starting (see the rule above).
export function stoppedBySandbox(isError, text) {
  if (!isError) return false;
  if (REFUSALS.some(pattern => pattern.test(text))) return true;
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
  const body = EXIT_LINE.test(lines[0] ?? '') ? lines.slice(1) : lines;
  return body.some(isSetupLine) && body.every(l => isSetupLine(l) || BASH_LINE.test(l));
}

// One trace, JSON lines: every Bash request with its result ({ id, command, isError, text, stopped }), the requests
// with no result anywhere in the trace, how many non-blank lines are not a JSON object, and whether the trace is empty.
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
  const blocks = type => entries.flatMap(e => (e.type === type && Array.isArray(e.message?.content) ? e.message.content : []));
  const requests = new Map();
  for (const b of blocks('assistant')) if (b?.type === 'tool_use' && b.name === 'Bash' && !requests.has(b.id)) requests.set(b.id, String(b.input?.command ?? ''));
  const results = new Map();
  for (const b of blocks('user')) {
    if (b?.type !== 'tool_result' || !requests.has(b.tool_use_id)) continue;
    const text = textOf(b);
    const isError = b.is_error === true;
    const seen = results.get(b.tool_use_id);
    // A request answered more than once counts once, and as stopped if any of its results says so.
    if (seen) seen.stopped ||= stoppedBySandbox(isError, text);
    else results.set(b.tool_use_id, { id: b.tool_use_id, command: requests.get(b.tool_use_id), isError, text, stopped: stoppedBySandbox(isError, text) });
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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The verdict: { measurement, sentence, calls, stopped, unanswered, unreadable, empty, missing, extra }. `traces` maps
// a run folder name to its trace text (null for a trace file that could not be read); `raw` is the parsed raw report,
// or null when there is none.
export function verdict(traces, raw) {
  const names = Object.keys(traces).sort();
  const runs = raw ? runsIn(raw) : null;
  let calls = 0;
  let unreadable = 0;
  const stopped = [];
  const unanswered = [];
  const empty = [];
  const unopened = [];
  for (const name of names) {
    if (traces[name] === null) { unopened.push(name); continue; }
    const read = bashCalls(traces[name]);
    if (read.empty) empty.push(name);
    calls += read.calls.length;
    unreadable += read.unreadable;
    unanswered.push(...read.unanswered.map(u => ({ trace: name, ...u })));
    for (const c of read.calls) if (c.stopped) stopped.push({ trace: name, ...c });
  }
  const missing = runs ? runs.filter(r => r.trace === null || !names.includes(r.trace)) : [];
  const extra = runs ? names.filter(n => !runs.some(r => r.trace === n)) : [];
  const asked = calls + unanswered.length;
  const reasons = [];
  if (!raw) reasons.push('the eval left no readable report of its agent runs, so nothing shows that each one left its trace');
  else if (!runs.length) reasons.push('the eval\'s report lists no agent runs');
  if (stopped.length) {
    const first = stopped[0].text.split('\n').map(l => l.trim()).find(l => isSetupLine(l) || /^Sandbox is (required|enabled)/.test(l)) ?? stopped[0].text.trim().split('\n')[0];
    reasons.push(`the sandbox kept ${stopped.length} of the ${asked} shell commands the agents asked for from starting, in ${new Set(stopped.map(s => s.trace)).size} of ${plural(names.length, 'agent run')}, so every grader that needed one of them failed (the first ended with: ${first})`);
  }
  if (unanswered.length) reasons.push(`${plural(unanswered.length, 'shell command')} the agents asked for got no result in the trace, as when a run is cut off in the middle of a command`);
  if (unreadable) reasons.push(`${plural(unreadable, 'trace line')} could not be read`);
  if (empty.length) reasons.push(`${plural(empty.length, 'trace file')} ${empty.length === 1 ? 'was' : 'were'} empty`);
  if (unopened.length) reasons.push(`${plural(unopened.length, 'trace file')} could not be opened`);
  if (runs && runs.length && (missing.length || extra.length)) {
    const parts = [];
    if (missing.length) parts.push(`${missing.length} of them left no trace`);
    if (extra.length) parts.push(`${plural(extra.length, 'trace')} ${extra.length === 1 ? 'belongs' : 'belong'} to no run it lists`);
    reasons.push(`the eval's report lists ${plural(runs.length, 'agent run')} and ${plural(names.length, 'trace')} ${names.length === 1 ? 'was' : 'were'} found: ${parts.join(', and ')}`);
  }
  const measurement = reasons.length === 0;
  const sentence = measurement
    ? `The sandbox started every shell command the agents asked for: ${calls} of ${calls}, and each of the ${plural(runs.length, 'agent run')} in the eval's report left a complete trace.`
    : `This run is not a measurement: ${reasons.join('; ')}.`;
  return { measurement, sentence, calls, stopped, unanswered, unreadable, empty, missing, extra };
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
  for (const s of v.stopped.slice(0, 10)) console.log(`  stopped, ${s.trace}: ${JSON.stringify(s.command).slice(0, 160)} -> ${JSON.stringify(s.text).slice(0, 300)}`);
  for (const u of v.unanswered.slice(0, 10)) console.log(`  no result, ${u.trace}: ${JSON.stringify(u.command).slice(0, 160)}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${v.measurement ? '' : '### Not a measurement\n\n'}${v.sentence}\n\n`);
  // One line each, whatever a trace held: control characters, line breaks included, are dropped.
  const oneLine = [...v.sentence].filter(ch => ch.charCodeAt(0) >= 32).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `measurement=${v.measurement ? 'true' : 'false'}\nsentence=${oneLine}\n`);
  if (!v.measurement) { console.log(`::error::${oneLine}`); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
