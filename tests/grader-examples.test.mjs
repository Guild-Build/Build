import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExampleGrader, evaluateExampleGrader } from '../cli/grader-examples.mjs';

const parse = source => parseExampleGrader(`---\n${source}\n---\n`);
const outcome = extra => ({ lastMessage: '', files: {}, changedFiles: [], toolCalls: [], ...extra });

test('regex examples use actual flags and treat missing files as failures for both modes', () => {
  const grader = parse("type: regex\npattern: '^ready$'\nflags: im\ntarget: last_message");
  assert.equal(evaluateExampleGrader(grader, outcome({ lastMessage: 'before\nREADY\nafter' })), true);
  assert.equal(evaluateExampleGrader(grader, outcome({ lastMessage: 'not ready' })), false);
  for (const match of ['contains', 'not_contains']) {
    const fileGrader = parse(`type: regex\npattern: 'secret'\nmatch: ${match}\ntarget:\n  source: file\n  path: output.txt`);
    assert.equal(evaluateExampleGrader(fileGrader, outcome()), false);
    assert.equal(evaluateExampleGrader(fileGrader, outcome({ files: { 'output.txt': 'secret' } })), match === 'contains');
    assert.equal(evaluateExampleGrader(fileGrader, outcome({ files: { 'output.txt': 'safe' } })), match === 'not_contains');
  }
  const global = parse("type: regex\npattern: 'x'\nflags: g");
  assert.equal(evaluateExampleGrader(global, outcome({ lastMessage: 'x' })), true);
  assert.equal(evaluateExampleGrader(global, outcome({ lastMessage: 'x' })), true);
});

test('file_exists checks changed-file paths rather than workspace inventory', () => {
  const present = parse('type: file_exists\npath: result.txt');
  const absent = parse('type: file_exists\npath: result.txt\nexists: false');
  const unchangedFile = outcome({ files: { 'result.txt': 'already there' } });
  assert.equal(evaluateExampleGrader(present, unchangedFile), false);
  assert.equal(evaluateExampleGrader(absent, unchangedFile), true);
  const changedFile = outcome({ changedFiles: ['result.txt'] });
  assert.equal(evaluateExampleGrader(present, changedFile), true);
  assert.equal(evaluateExampleGrader(absent, changedFile), false);
});

test('tool_used matches serialized inputs, exact tool names and count bounds', () => {
  const grader = parse('type: tool_used\ntool: Bash\ninput_match: \'"command"\\s*:\\s*"node --test"\'\nmin: 1\nmax: 1');
  const call = { name: 'Bash', inputText: JSON.stringify({ command: 'node --test', description: 'Run the suite' }) };
  assert.equal(evaluateExampleGrader(grader, outcome({ toolCalls: [call] })), true);
  assert.equal(evaluateExampleGrader(grader, outcome({ toolCalls: [call, call] })), false);
  assert.equal(evaluateExampleGrader(grader, outcome({ toolCalls: [{ ...call, name: 'bash' }] })), false);
  assert.equal(evaluateExampleGrader(grader, outcome({ toolCalls: [{ name: 'Bash', inputText: JSON.stringify({ command: 'echo node --test' }) }] })), false);
  const forbidden = parse('type: tool_used\ntool: Write\nmin: 0\nmax: 0\narm: both');
  assert.equal(evaluateExampleGrader(forbidden, outcome()), true);
  assert.equal(evaluateExampleGrader(forbidden, outcome({ toolCalls: [{ name: 'Write', inputText: '{}' }] })), false);
});

test('rejects unsupported syntax and semantics instead of approximating them', () => {
  for (const source of [
    'type: llm', 'type: baseline', 'type: tool_order',
    "type: regex\npattern: 'x'\nmatch: count:2",
    "type: regex\npattern: 'x'\ntarget: trace",
    "type: regex\npattern: 'x'\nflags: ii",
    "type: regex\npattern: 'x'\npattern: 'y'",
    "type: regex\npattern: 'x'\nunknown: true",
    "type: regex\npattern: 'x'\narm: with",
    'type: regex\npattern: |\n  multiline',
    '"type": regex\npattern: x',
    'type: regex\n<<: *defaults\npattern: x',
    "type: regex\npattern: 'x'\ntarget:\n  source: file\n  path: ../private.txt",
    'type: file_exists\npath: **/result.txt',
    'type: file_exists\npath: result.txt\nexists: maybe',
    'type: tool_used\ntool: Bash\nmin: 2\nmax: 1',
    'type: tool_used\ntool: Bash\nmax: Infinity',
    'type: tool_used\ntool: Bash\nweight: 0',
    "type: tool_used\ntool: Bash\nmin: '1'",
    "type: tool_used\ntool: Bash\nweight: '1'",
    'type: tool_used\ntool: Bash\ninput_match: true',
    "type: file_exists\npath: result.txt\nexists: 'false'",
    'type: regex\npattern: 123',
    'type: regex\npattern: true',
    "type: regex\npattern: 'x'\nflags: null",
    "type: regex\npattern: 'x'\ntarget: null",
    "type: regex\npattern: 'x'\nmatch: null",
    "type: file_exists\npath: ' x '",
    'type: file_exists\npath: "x\\ny"',
  ]) assert.throws(() => parse(source), undefined, source);
});

test('preserves quoted strings and unquoted numbers and booleans', () => {
  assert.equal(parse("type: regex\npattern: '123'").pattern, '123');
  assert.equal(parse('type: tool_used\ntool: Bash\nmin: 0\nmax: 2\nweight: 1.5').weight, 1.5);
  assert.equal(parse('type: file_exists\npath: result.txt\nexists: false').exists, false);
});
