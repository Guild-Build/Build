// Runs the build's SessionStart hook on a fresh copy of each of the trial's eight repositories, the way the eval
// scaffolds them, and writes what it would add to the context: a JSON list of the distinct texts (the markers the proof
// looks for in every request) and, per case, the text and its length. Usage: node expected-context.mjs <hook> <out-dir>
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [hook, out] = process.argv.slice(2).map(p => resolve(p));
const cases = join(root, 'content/trials/client-deployment-v1/cases');
const perCase = {};
for (const name of readdirSync(cases).sort()) {
  const ws = mkdtempSync(join(tmpdir(), `expected-${name}-`));
  const env = { ...process.env, HOME: ws, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const fx = spawnSync('bash', ['-e', join(cases, name, 'fixture.sh')], { cwd: ws, env, encoding: 'utf8' });
  if (fx.status !== 0) throw new Error(`${name}: fixture failed: ${fx.stderr}`);
  const r = spawnSync('bash', [hook], { cwd: ws, env: { ...env, CLAUDE_PROJECT_DIR: ws }, encoding: 'utf8', input: '{"hook_event_name":"SessionStart","source":"startup"}' });
  const text = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : null;
  perCase[name] = { status: r.status, text, length: text?.length ?? 0 };
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'markers.json'), JSON.stringify([...new Set(Object.values(perCase).map(c => c.text).filter(Boolean))]) + '\n');
writeFileSync(join(out, 'expected.json'), JSON.stringify(perCase, null, 2) + '\n');
for (const [name, c] of Object.entries(perCase)) console.log(`${name}: exit ${c.status}, ${c.length} characters`);
console.log(JSON.stringify(Object.values(perCase)[0].text));
