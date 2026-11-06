import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// The private trace format is verified against this installed runner, not a public
// API. Fail preflight on another version rather than spend money and lose evidence.
export const responseRunnerVersion = '2.1.314';
export const runnerTracePrefix = (platform = process.platform) => platform === 'darwin' ? 'e-' : 'claude-eval-';
const rootPattern = new RegExp(`^${runnerTracePrefix()}[A-Za-z0-9]{6}$`);
const maxTraceBytes = 16 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function inventoryRunnerTraces() {
  if (typeof process.getuid !== 'function' || constants.O_NOFOLLOW === undefined)
    throw Error('Response capture requires POSIX ownership and no-follow file access.');
  if (process.getuid() === 0) throw Error('Response capture requires a non-root user; the runner cannot seal retained sandboxes as root.');
  // This runner hard-codes /tmp on macOS, ignoring TMPDIR.
  const base = realpathSync(process.platform === 'darwin' ? '/tmp' : tmpdir());
  return { base, existingRoots: readdirSync(base).filter(name => rootPattern.test(name)) };
}

function ownedPrivate(st) {
  return typeof process.getuid === 'function' && st.uid === process.getuid() && (st.mode & 0o077) === 0;
}

function readTrace(path, inventory) {
  if (typeof path !== 'string' || resolve(path) !== path) throw Error('Trace path is absent or noncanonical.');
  const parts = relative(inventory.base, path).split(sep);
  if (parts.length !== 3 || !rootPattern.test(parts[0]) || parts[1] !== 'out' || parts[2] !== 'trace.jsonl'
    || inventory.existingRoots.includes(parts[0])) throw Error('Trace is outside a new runner sandbox.');
  for (const directory of [join(inventory.base, parts[0]), join(inventory.base, parts[0], 'out')]) {
    const st = lstatSync(directory);
    if (!st.isDirectory() || !ownedPrivate(st)) throw Error('Trace directory is not owned, private and regular.');
  }
  const before = lstatSync(path);
  if (!before.isFile() || !ownedPrivate(before) || before.nlink !== 1 || before.size > maxTraceBytes)
    throw Error('Trace file is not a bounded, private regular file.');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || !ownedPrivate(opened) || opened.nlink !== 1 || opened.size > maxTraceBytes
      || before.dev !== opened.dev || before.ino !== opened.ino || realpathSync(path) !== path)
      throw Error('Trace changed while opening.');
    // Read at most the observed size plus one byte even if an untrusted process
    // grows the file between stat and read.
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0, count;
    while (length < buffer.length && (count = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += count;
    const bytes = buffer.subarray(0, length);
    const after = fstatSync(fd);
    if (bytes.length > maxTraceBytes || bytes.length !== opened.size || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
      throw Error('Trace changed while reading.');
    return bytes;
  } finally { closeSync(fd); }
}

export function extractResponse(bytes, arm) {
  let events;
  try {
    events = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    if (!events.length || events.some(event => !event || typeof event !== 'object' || Array.isArray(event))) throw Error();
  } catch { return { status: 'unavailable', finalResponse: null, graderTargetText: null, issue: 'Trace JSONL is empty, malformed or truncated.' }; }
  // Match the runner's last_message grader target exactly: last assistant event
  // with text blocks, joined by newline. Tool/thinking blocks are never copied.
  let graderTargetText = null;
  for (const event of events) {
    if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) continue;
    const texts = event.message.content.filter(block => block?.type === 'text');
    if (texts.length) graderTargetText = texts.map(block => String(block.text ?? '')).join('\n');
  }
  const terminal = events.at(-1);
  const complete = arm?.error === null && !arm.aborted
    && events.filter(event => event.type === 'result').length === 1
    && terminal?.type === 'result' && terminal.subtype === 'success' && terminal.is_error === false
    && terminal.parent_tool_use_id == null
    && typeof terminal.result === 'string' && terminal.result.trim().length > 0
    && !terminal.result.endsWith('The response above may be incomplete.')
    && graderTargetText !== null;
  return {
    status: complete ? 'complete' : 'incomplete',
    finalResponse: complete ? terminal.result : null,
    graderTargetText,
    issue: complete ? null : 'No confirmed successful final response; graded text may be partial.',
  };
}

export function captureResponses(raw, { cases, runs, inventory }) {
  const rows = Array.isArray(raw?.cases) ? raw.cases : [];
  const paths = rows.flatMap(row => Array.isArray(row?.arms?.with) ? row.arms.with.map(arm => arm?.tracePath) : []);
  const captured = cases.map(({ name }) => {
    const matches = rows.filter(row => row?.name === name);
    const arms = matches.length === 1 && Array.isArray(matches[0].arms?.with) ? matches[0].arms.with : [];
    return { name, attempts: Array.from({ length: runs }, (_, index) => {
      const arm = arms[index];
      const base = { number: index + 1, status: 'unavailable', finalResponse: null, graderTargetText: null, traceSha256: null, tracePath: null, issue: null };
      if (!arm || !inventory) return { ...base, issue: 'No attempt trace was available.' };
      if (paths.filter(path => path === arm.tracePath).length !== 1) return { ...base, issue: 'Trace path was reused across attempts.' };
      try {
        const bytes = readTrace(arm.tracePath, inventory);
        return { ...base, ...extractResponse(bytes, arm), traceSha256: digest(bytes), tracePath: arm.tracePath };
      } catch {
        // Do not echo potentially sensitive paths or filesystem errors into HTML.
        return { ...base, issue: 'Trace could not be read safely from a new private runner sandbox.' };
      }
    }) };
  });
  return {
    schema: 'buildguild.responses.v1',
    sources: { finalResponse: 'successful terminal result.result', graderTargetText: 'last assistant event with text blocks (runner last_message target)' },
    complete: captured.every(row => row.attempts.every(attempt => attempt.status === 'complete')),
    cases: captured,
  };
}
