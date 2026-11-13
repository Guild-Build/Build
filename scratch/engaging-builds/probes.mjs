// Writes the scratch probe builds, one per mechanism, each a copy of the sandbox self-test's empty build plus the
// mechanism under test. Usage: node scratch/engaging-builds/probes.mjs <out-dir> <log-dir>. Probe X logs each hook run
// to <log-dir>/probe-x.jsonl. Prints the probe ids.
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const [out, logs] = process.argv.slice(2).map(p => resolve(p));
const hook = (event, form, id) => ({ hooks: { [event]: [{ hooks: [{ type: 'command', command: `bash "\${CLAUDE_PLUGIN_ROOT}/scripts/probe.sh" ${id} ${form} "${join(logs, `probe-${id.toLowerCase()}.jsonl`)}"`, timeout: 15 }] }] } });
export const PROBES = {
  P1: { label: 'SessionStart hook, plain standard output', hooks: hook('SessionStart', 'plain', 'P1'), markers: ['BGPROBE-P1'] },
  P2: { label: 'SessionStart hook, hookSpecificOutput.additionalContext', hooks: hook('SessionStart', 'json', 'P2'), markers: ['BGPROBE-P2'] },
  P3: { label: 'UserPromptSubmit hook, plain standard output', hooks: hook('UserPromptSubmit', 'plain', 'P3'), markers: ['BGPROBE-P3'] },
  P3J: { label: 'UserPromptSubmit hook, hookSpecificOutput.additionalContext', hooks: hook('UserPromptSubmit', 'json', 'P3J'), markers: ['BGPROBE-P3J'] },
  P4: { label: 'Stop hook, decision block with a reason and a systemMessage, once', hooks: hook('Stop', 'stop-block', 'P4'), markers: ['BGPROBE-P4-REASON', 'BGPROBE-P4-SYSMSG'] },
  P4S: { label: 'Stop hook, systemMessage only (the form measured-delivery returns)', hooks: hook('Stop', 'stop-sysmsg', 'P4S'), markers: ['BGPROBE-P4S-SYSMSG'] },
  P5: { label: 'Output style with force-for-plugin: true', hooks: null, style: true, markers: ['BGPROBE-P5'] },
};
for (const [id, p] of Object.entries(PROBES)) {
  const dir = join(out, id.toLowerCase());
  cpSync(join(root, '.github/sandbox-self-test/empty-build'), dir, { recursive: true });
  const slug = `probe-${id.toLowerCase()}`;
  writeFileSync(join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: slug, version: '0.0.1', description: `Scratch probe: ${p.label}.`, license: 'Apache-2.0' }, null, 2) + '\n');
  writeFileSync(join(dir, 'buildguild.json'), JSON.stringify({ schema: 'buildguild.build.v1', slug, version: '0.0.1', branches: ['claude-code'], category: 'other', modules: [], name: `Probe ${id}`, summary: `Scratch probe build for ${p.label}; never published.`, license: 'Apache-2.0' }, null, 2) + '\n');
  if (p.hooks) {
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'hooks/hooks.json'), JSON.stringify(p.hooks, null, 2) + '\n');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(join(here, 'probe.mjs'), join(dir, 'scripts/probe.mjs'));
    writeFileSync(join(dir, 'scripts/probe.sh'), '#!/usr/bin/env bash\n# Scratch probe hook: hands its input to probe.mjs.\nexec node "$(dirname "$0")/probe.mjs" "$@"\n', { mode: 0o755 });
  }
  if (p.style) {
    mkdirSync(join(dir, 'output-styles'), { recursive: true });
    writeFileSync(join(dir, 'output-styles/bgprobe.md'), '---\nname: bgprobe\ndescription: Scratch probe output style\nforce-for-plugin: true\nkeep-coding-instructions: true\n---\n\nBGPROBE-P5: this text comes from a plugin output style with force-for-plugin set to true.\n');
  }
}
console.log(Object.entries(PROBES).map(([id, p]) => `${id}\t${p.markers.join(',')}\t${p.label}`).join('\n'));
