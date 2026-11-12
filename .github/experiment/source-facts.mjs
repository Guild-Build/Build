// Prints where the pinned Claude Code binary holds the code the after-trial rule relies on: byte offset and context.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const path = process.argv[2];
const buf = readFileSync(path);
console.log(`binary ${path}, ${buf.length} bytes, sha256 ${createHash('sha256').update(buf).digest('hex')}`);
const needles = [
  'Shell command failed");this.name="ShellError"',
  '[`Exit code ${e.code}`',
  '||"Command failed with no output"',
  'content:`<tool_use_error>InputValidationError: ${',
  ' hook error: ${',
  'Blocked: ${',
  '. To wait for a condition, use Monitor with an until-loop',
  '<error>Command was aborted before completion</error>',
  '("No matches found")],["rg"',
  'non_execution_kind is the harness-stamped reason',
  'permission_decision is how the call',
  'bridge socket is missing (socat may have died). Restart to retry.',
  'Sandbox is required (sandbox.failIfUnavailable) and stopped being available in this session: ${',
  ',is_error:!0,tool_use_id:n}],...',
];
for (const n of needles) {
  const hits = [];
  let i = buf.indexOf(n);
  while (i !== -1 && hits.length < 3) { hits.push(i); i = buf.indexOf(n, i + 1); }
  let total = hits.length; while (i !== -1) { total++; i = buf.indexOf(n, i + 1); }
  console.log(`\n### ${JSON.stringify(n)}: ${total} hit(s)`);
  for (const h of hits) console.log(`  @${h}: ${buf.subarray(Math.max(0, h - 260), h + 340).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`);
}
