// After the trial: did the sandbox let the agents' shell commands start? It reads every agent trace the eval kept and
// looks at each result the Bash tool returned. A call counts as stopped by the sandbox when the Bash tool returned an
// error and its output, after Claude Code's own "Exit code N" line, holds at least one line the sandbox prints when it
// cannot start a command (it begins "bwrap: ", bubblewrap's prefix, "apply-seccomp: ", the prefix of the sandbox's
// seccomp helper, or "Sandbox is required", Claude Code's refusal), and nothing but such lines and bash's own
// complaints (lines that begin "bash: " or "/bin/bash: "). Those lines all come before the command exists: the helper
// and bubblewrap print one line and exit when they fail, and the shell that would have started the command prints its
// own complaints first. A command that started prints its own output, which is none of these, so a failing test or a
// script that exits 1 never matches; a command that failed silently leaves no sandbox line, which the rule needs. If
// any call matches, the run is not a measurement.
//
// Usage: node .github/scripts/shell-starts.mjs <folder holding claude-eval-*/out/trace.jsonl> [<evidence id>]
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// How each line the sandbox prints when it cannot start a command begins: bubblewrap's prefix, the prefix of every
// message from the sandbox's seccomp helper (apply-seccomp, in @anthropic-ai/sandbox-runtime), and Claude Code's
// refusal of a command when a required sandbox is unavailable.
export const SANDBOX_PREFIXES = ['bwrap: ', 'apply-seccomp: ', 'Sandbox is required'];
const isSandboxLine = line => SANDBOX_PREFIXES.some(prefix => line.startsWith(prefix));
const BASH_LINE = /^(?:(?:\/usr)?\/bin\/)?bash: /;
const EXIT_LINE = /^Exit code -?\d+$/;

// The text of a tool result, which Claude Code writes as a string or as a list of text blocks.
const textOf = block => typeof block.content === 'string' ? block.content
  : Array.isArray(block.content) ? block.content.map(b => (b && b.type === 'text' ? b.text : '')).join('\n') : '';

// True when this Bash result shows that the sandbox kept the command from starting (see the rule above).
export function stoppedBySandbox(isError, text) {
  if (!isError) return false;
  const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
  const body = EXIT_LINE.test(lines[0] ?? '') ? lines.slice(1) : lines;
  return body.some(l => isSandboxLine(l)) && body.every(l => isSandboxLine(l) || BASH_LINE.test(l));
}

// Every Bash call in one trace (JSON lines) with its result: { id, command, isError, text, stopped }. A call with no
// result in the trace is left out; a line that is not JSON is counted, not read.
export function bashCalls(trace) {
  const commands = new Map();
  const calls = [];
  let unreadable = 0;
  for (const line of trace.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { unreadable++; continue; }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && block.name === 'Bash') commands.set(block.id, String(block.input?.command ?? ''));
      if (entry.type === 'user' && block?.type === 'tool_result' && commands.has(block.tool_use_id)) {
        const text = textOf(block);
        const isError = block.is_error === true;
        calls.push({ id: block.tool_use_id, command: commands.get(block.tool_use_id), isError, text, stopped: stoppedBySandbox(isError, text) });
      }
    }
  }
  return { calls, unreadable };
}

// The verdict over every trace: { calls, stopped, unreadable, measurement, sentence }. `traces` maps a name to its
// text. A run with no trace at all is not a measurement either: nothing shows what its agents did.
export function verdict(traces) {
  const runs = Object.keys(traces).length;
  let calls = 0;
  let unreadable = 0;
  const stopped = [];
  for (const [name, text] of Object.entries(traces)) {
    const read = bashCalls(text);
    calls += read.calls.length;
    unreadable += read.unreadable;
    for (const c of read.calls) if (c.stopped) stopped.push({ trace: name, ...c });
  }
  const measurement = runs > 0 && stopped.length === 0;
  const first = stopped[0] ? stopped[0].text.split('\n').map(l => l.trim()).filter(l => isSandboxLine(l))[0] : '';
  const sentence = runs === 0
    ? 'This run is not a measurement: the trial left no agent traces, so nothing shows what its agents did or that their shell commands ran.'
    : measurement
      ? `The sandbox started every shell command the agents asked for: ${calls} of ${calls}, across ${runs} agent run(s).`
      : `This run is not a measurement: the sandbox kept ${stopped.length} of the ${calls} shell commands the agents asked for from starting, in ${new Set(stopped.map(s => s.trace)).size} of ${runs} agent run(s), so every grader that needed one of them failed. The first one ended with: ${first}`;
  return { calls, stopped, unreadable, measurement, sentence };
}

// The traces under a folder of kept eval runs, keyed by run folder name.
export function tracesIn(dir) {
  if (!existsSync(dir)) return {};
  const traces = {};
  for (const name of readdirSync(dir).filter(n => n.startsWith('claude-eval-')).sort()) {
    const path = join(dir, name, 'out', 'trace.jsonl');
    if (existsSync(path)) traces[name] = readFileSync(path, 'utf8');
  }
  return traces;
}

function main() {
  const [dir] = process.argv.slice(2);
  if (!dir) { console.error('usage: node .github/scripts/shell-starts.mjs <folder holding claude-eval-*/out/trace.jsonl>'); process.exit(2); }
  const v = verdict(tracesIn(resolve(dir)));
  console.log(v.sentence);
  if (v.unreadable) console.log(`note: ${v.unreadable} trace line(s) were not JSON and were skipped`);
  for (const s of v.stopped.slice(0, 10)) console.log(`  ${s.trace}: ${JSON.stringify(s.command).slice(0, 160)} -> ${JSON.stringify(s.text).slice(0, 300)}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${v.measurement ? '' : '### Not a measurement\n\n'}${v.sentence}\n\n`);
  // One line each, whatever a trace held: control characters, line breaks included, are dropped.
  const oneLine = [...v.sentence].filter(ch => ch.charCodeAt(0) >= 32).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `measurement=${v.measurement ? 'true' : 'false'}\nsentence=${oneLine}\n`);
  if (!v.measurement) { console.log(`::error::${v.sentence}`); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
