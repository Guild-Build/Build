import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPreparation } from '../cli/comparison-review.mjs';

const plan = {
  schema: 'buildguild.comparison-preparation.v1',
  visibility: 'private',
  builds: [
    { slug: 'delivery', version: '1.0.0', plugin: { name: 'delivery-plugin', version: '1.0.0' }, sha256: 'current-snapshot' },
    { slug: 'handoff', version: '2.0.0', plugin: { name: 'handoff-plugin', version: '2.0.0' }, sha256: 'candidate-snapshot' },
  ],
  trial: { slug: 'team-tasks', version: '2.0.0', sha256: 'trial-snapshot', cases: [{ name: 'handoff-task', dimension: 'handoff' }] },
  settings: { model: 'claude-test-model', runs: 3, requestedMaxCostUsd: 4, requiredRunnerVersion: '2.1.314',
    effortSource: 'runner default; not exposed by eval', acceptance: 'all deterministic graders pass' },
  totalAttempts: 6,
  allocatedMaxCostUsd: [2, 2],
  tasks: [{ name: 'handoff-task', caseYaml: 'context:\n  scaffold_script: fixture.sh', promptMarkdown: 'Do the handoff.', graders: [{ name: 'result', markdown: 'Check the outcome.' }] }],
};
const options = {
  planSha256: 'reviewed-plan-hash',
  executeCommand: 'buildguild compare --execute plan --plan-sha256 reviewed-plan-hash',
};

test('presents the exact comparison workload and states the limit separately from cost', () => {
  const html = renderPreparation(plan, options);
  for (const expected of [
    'delivery · v1.0.0', 'handoff · v2.0.0', 'current-snapshot', 'candidate-snapshot', 'trial-snapshot',
    'Total planned attempts</dt><dd>6', 'Attempts per case per build</dt><dd>3', 'claude-test-model',
    'Required Claude Code version</dt><dd>2.1.314', 'Requested total limit</dt><dd>USD 4',
    'Actual cost</dt><dd>Unknown', 'An attempt already in flight can exceed it',
    'made no model calls and ran no fixtures or plugin hooks', 'model availability and provider quota still need verification',
    'Case metadata and fixture', 'scaffold_script: fixture.sh', 'Do the handoff.', 'Check the outcome.', 'reviewed-plan-hash', options.executeCommand,
  ]) assert.ok(html.includes(expected), expected);
  assert.equal(html.match(/Allocated limit<\/dt><dd>USD 2/g)?.length, 2);
});

test('escapes plan values, task sources, command and hash with no executable or remote content', () => {
  const injected = '<img src="https://example.invalid/asset" onerror="alert(1)">';
  const escaped = '&lt;img src=&quot;https://example.invalid/asset&quot; onerror=&quot;alert(1)&quot;&gt;';
  const hostile = structuredClone(plan);
  hostile.builds[0].slug = injected;
  hostile.trial.slug = injected;
  hostile.settings.model = injected;
  hostile.tasks[0].caseYaml = injected;
  hostile.tasks[0].promptMarkdown = injected;
  hostile.tasks[0].graders[0].markdown = injected;
  const html = renderPreparation(hostile, { planSha256: injected, executeCommand: injected });
  assert.equal(html.split(escaped).length - 1, 8);
  assert.doesNotMatch(html, /<(?:script|img|iframe|link)\b|\b(?:src|href)="https?:\/\//i);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
});
