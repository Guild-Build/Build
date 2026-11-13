// Scratch probe hook, run by probe.sh. It records how Claude Code ran it (its standard input, working folder, a few
// environment variables, and what it sees of the case's repository) as one JSON line in the probe log, then prints the
// output of the mechanism under test. Probe builds only; never shipped.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [probe, form, log] = process.argv.slice(2);
let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch {}
let input = {};
try { input = JSON.parse(raw); } catch {}
const look = dir => {
  try {
    const git = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    return { exists: existsSync(dir), entries: readdirSync(dir).sort().slice(0, 40), runbook: existsSync(join(dir, 'docs/RUNBOOK.md')),
      readme: existsSync(join(dir, 'README.md')), gitTop: git.status === 0 ? git.stdout.trim() : `exit ${git.status}` };
  } catch (e) { return { error: e.code || String(e) }; }
};
const env = Object.fromEntries(['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_ENV_FILE', 'HOME', 'PWD', 'TMPDIR',
  'CLAUDE_CODE_ENTRYPOINT', 'SANDBOX_RUNTIME', 'CLAUDE_CODE_EVAL_CONFINED'].map(k => [k, process.env[k] ?? null]));
const record = { probe, form, at: new Date().toISOString(), stdinBytes: raw.length, stdin: input, processCwd: process.cwd(), env,
  atProcessCwd: look(process.cwd()), atInputCwd: typeof input.cwd === 'string' ? look(input.cwd) : null };
try { appendFileSync(log, JSON.stringify(record) + '\n'); } catch {}

const marker = `BGPROBE-${probe}`;
const event = input.hook_event_name || 'unknown';
if (form === 'plain') process.stdout.write(`${marker}: plain standard output from a ${event} hook.\n`);
else if (form === 'json') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: `${marker}: additionalContext from a ${event} hook.` } }));
else if (form === 'stop-block') {
  if (input.stop_hook_active !== true) process.stdout.write(JSON.stringify({ decision: 'block', reason: `${marker}-REASON: a Stop hook blocked once with this reason.`, systemMessage: `${marker}-SYSMSG: a Stop hook's systemMessage.` }));
} else if (form === 'stop-sysmsg') process.stdout.write(JSON.stringify({ systemMessage: `${marker}-SYSMSG: a Stop hook's systemMessage, as measured-delivery returns one.` }));
