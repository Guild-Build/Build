import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { captureResponses, extractResponse, inventoryRunnerTraces, runnerTracePrefix } from '../cli/comparison-responses.mjs';

const text = text => ({ type: 'text', text });
const assistant = (content, parent_tool_use_id = null) => ({ type: 'assistant', parent_tool_use_id, message: { content } });
const result = { type: 'result', subtype: 'success', is_error: false, result: 'Actual final response' };
const graded = assistant([text('Potentially graded text')]);
const jsonl = (...rows) => Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
const successful = jsonl(graded, result);
const validArm = { error: null };

test('refuses root before any retained sandbox can be launched', t => {
  t.mock.method(process, 'getuid', () => 0);
  assert.throws(() => inventoryRunnerTraces(), /non-root/);
});

test('matches runner coercion for every text block without including other blocks', () => {
  const response = extractResponse(jsonl(assistant([null, text(7), text(null), text({ value: 1 }), { type: 'thinking', text: 'omit' }]), result), validArm);
  assert.equal(response.graderTargetText, '7\n\n[object Object]');
  assert.equal(response.finalResponse, 'Actual final response');
});
const traceRoot = suffix => runnerTracePrefix() + suffix;

test('uses the trace directory prefixes emitted by the supported runner platforms', () => {
  assert.equal(runnerTracePrefix('darwin'), 'e-');
  assert.equal(runnerTracePrefix('linux'), 'claude-eval-');
});

test('keeps the terminal response separate from the exact last_message grader text', () => {
  const response = extractResponse(jsonl(
    assistant([text('Old draft')]),
    assistant([text('First part'), { type: 'thinking', thinking: 'Private reasoning' }, text('Second part')], 'child-tool'),
    assistant([{ type: 'tool_use', input: { private: 'Do not retain' } }]),
    result,
  ), validArm);
  assert.deepEqual(response, {
    status: 'complete',
    finalResponse: 'Actual final response',
    graderTargetText: 'First part\nSecond part',
    issue: null,
  });
});

test('keeps unconfirmed outcomes explicit even when the trace contains assistant text', async t => {
  for (const [name, tail, arm] of [
    ['no terminal result', [], validArm],
    ['child terminal result', [{ ...result, parent_tool_use_id: 'child-tool' }], validArm],
    ['more than one result', [result, result], validArm],
    ['aborted attempt', [result], { ...validArm, aborted: true }],
    ['runner error', [result], { error: 'runner failure' }],
    ['errored terminal result', [{ ...result, is_error: true }], validArm],
    ['maximum turns', [{ ...result, subtype: 'error_max_turns' }], validArm],
    ['incomplete response marker', [{ ...result, result: 'Draft. The response above may be incomplete.' }], validArm],
  ]) {
    await t.test(name, () => {
      const response = extractResponse(jsonl(graded, ...tail), arm);
      assert.equal(response.status, 'incomplete');
      assert.equal(response.finalResponse, null);
      assert.equal(response.graderTargetText, 'Potentially graded text');
      assert.ok(response.issue);
    });
  }
  const malformed = Buffer.concat([successful, Buffer.from('{"type":"assistant"')]);
  const invalidUtf8 = Buffer.concat([successful, Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"'), Buffer.from([0xff]), Buffer.from('"}]}}')]);
  for (const bytes of [malformed, invalidUtf8]) {
    const response = extractResponse(bytes, validArm);
    assert.equal(response.status, 'unavailable');
    assert.equal(response.finalResponse, null);
    assert.equal(response.graderTargetText, null);
  }
});

function sandbox(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bg-response-test-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const make = (root = traceRoot('abc123'), bytes = successful) => {
    const output = join(base, root, 'out');
    mkdirSync(join(base, root), { mode: 0o700 });
    mkdirSync(output, { mode: 0o700 });
    const path = join(output, 'trace.jsonl');
    writeFileSync(path, bytes, { mode: 0o600 });
    return path;
  };
  const capture = (paths, { existingRoots = [], runs = paths.length } = {}) =>
    captureResponses({ cases: [{ name: 'handoff', arms: { with: paths.map(tracePath => ({ ...validArm, tracePath })) } }] }, {
      cases: [{ name: 'handoff' }], runs, inventory: { base, existingRoots },
    });
  return { base, make, capture };
}

test('maps trace digests and response evidence to the planned attempt slots', t => {
  const { make, capture } = sandbox(t);
  const first = make();
  const secondBytes = jsonl(assistant([text('Other graded text')]), { ...result, result: 'Second final response' });
  const second = make(traceRoot('def456'), secondBytes);
  const report = capture([first, second], { runs: 3 });
  assert.equal(report.complete, false);
  assert.equal(report.cases[0].name, 'handoff');
  const attempts = report.cases[0].attempts;
  assert.deepEqual(attempts.map(({ number, status, finalResponse }) => ({ number, status, finalResponse })), [
    { number: 1, status: 'complete', finalResponse: 'Actual final response' },
    { number: 2, status: 'complete', finalResponse: 'Second final response' },
    { number: 3, status: 'unavailable', finalResponse: null },
  ]);
  assert.equal(attempts[1].traceSha256, createHash('sha256').update(secondBytes).digest('hex'));
  assert.equal(attempts[2].traceSha256, null);
});

test('rejects traces that are stale, unsafe or assigned to multiple attempts', async t => {
  for (const [name, modify] of [
    ['preexisting root', path => [[path], { existingRoots: [traceRoot('abc123')] }]],
    ['outside runner root', (path, base) => {
      const target = join(base, 'external.jsonl');
      writeFileSync(target, successful, { mode: 0o600 });
      return [[target]];
    }],
    ['linked parent', (path, base) => {
      symlinkSync(join(base, traceRoot('abc123')), join(base, traceRoot('def456')), 'dir');
      return [[join(base, traceRoot('def456'), 'out', 'trace.jsonl')]];
    }],
    ['linked trace file', path => {
      const target = join(dirname(path), 'source.jsonl');
      writeFileSync(target, successful, { mode: 0o600 });
      rmSync(path);
      symlinkSync(target, path);
      return [[path]];
    }],
    ['hard-linked trace file', path => {
      linkSync(path, join(dirname(path), 'duplicate.jsonl'));
      return [[path]];
    }],
    ['world-readable trace', path => { chmodSync(path, 0o644); return [[path]]; }],
    ['oversized trace', path => { truncateSync(path, 16 * 1024 * 1024 + 1); return [[path]]; }],
    ['reused trace', path => [[path, path]]],
  ]) {
    await t.test(name, subtest => {
      const { base, make, capture } = sandbox(subtest);
      const path = make();
      const [paths, options] = modify(path, base);
      const report = capture(paths, options);
      assert.equal(report.complete, false);
      for (const attempt of report.cases[0].attempts) {
        assert.equal(attempt.status, 'unavailable');
        assert.equal(attempt.finalResponse, null);
        assert.equal(attempt.graderTargetText, null);
        assert.equal(attempt.traceSha256, null);
        assert.ok(attempt.issue);
      }
    });
  }
});
