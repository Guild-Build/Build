// Runs the pull request's own completeness() (rule (a) of the after-trial check) over real traces: every
// claude-eval-*/out/trace.jsonl and every scn-*/trace.jsonl under the folders given, and prints what keeps each from
// being complete.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { completeness, gaps } from '../scripts/shell-starts.mjs';

let checked = 0;
let incomplete = 0;
for (const root of process.argv.slice(2)) {
  for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
    const path = [join(root, name, 'out', 'trace.jsonl'), join(root, name, 'trace.jsonl')].find(p => existsSync(p));
    if (!path) continue;
    const c = completeness(readFileSync(path, 'utf8'));
    const missing = gaps(c);
    checked++;
    if (missing.length) incomplete++;
    console.log(`${missing.length ? 'NOT COMPLETE' : 'complete'} ${name}: ${c.requestIds.length} tool requests${missing.length ? `: ${missing.join('; ')}` : ''}`);
  }
}
console.log(`${checked} traces checked, ${incomplete} not complete`);
