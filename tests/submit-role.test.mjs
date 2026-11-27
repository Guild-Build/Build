// What the CLI tells a runner about a record's role: the guild decides at acceptance, from the GitHub account that
// publishes the record, whether it is the author's own run or a reproduction; the role the record carries is a hint.
// Offline: gh is a stand-in that only reports a login, and every run is cancelled before anything is published or sent.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const SENTENCE = login => `The guild decides at acceptance whether this record is the build author's own run or a reproduction, from the GitHub account that publishes it ("${login}"); if the role below is author or assayer the guild takes it only as a hint, and it refuses any other role.`;

function setup(t, login) {
  const root = mkdtempSync(join(tmpdir(), 'bg-submit-role-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  const exe = (name, code) => writeFileSync(join(root, 'bin', name), `#!${process.execPath}\n${code}`, { mode: 0o700 });
  exe('which', `
    const { accessSync, constants } = require('node:fs');
    const path = require('node:path').join(process.env.PATH, process.argv[2]);
    try { accessSync(path, constants.X_OK); console.log(path); } catch { process.exit(1); }
  `);
  exe('gh', `
    require('node:fs').appendFileSync(${JSON.stringify(join(root, 'gh.log'))}, JSON.stringify(process.argv.slice(2)) + '\\n');
    if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['api', 'user', '--jq', '.login'])) process.exit(90);
    console.log(${JSON.stringify(login)});
  `);
  const record = role => ({ schema: 'buildguild.evidence.v1', id: 'synthetic', build: 'local-build', buildVersion: '0.1.0', trial: 'sample-trial', trialVersion: '1.0.0',
    date: '2026-11-28', runner: 'whoever-ran-it', role, gist: null, environment: { os: 'darwin', claudeCode: '2.1.322', model: 'claude-sonnet-5-5' },
    results: { overallScore: 1, casesPassed: 1, casesTotal: 1, dimensions: { quality: 1 } }, cost: null });
  const invoke = (args, input) => new Promise(resolve => {
    const child = execFile(process.execPath, [cli, ...args], { cwd: root, env: { PATH: join(root, 'bin'), HOME: root, BUILDGUILD_ORIGIN: 'http://127.0.0.1:9' }, timeout: 25000 },
      (error, stdout, stderr) => resolve({ status: error?.code ?? 0, stdout, stderr }));
    child.stdin.end(input);
  });
  return { root, record, invoke, ghCalls: () => readFileSync(join(root, 'gh.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) };
}

for (const role of ['author', 'assayer', 'guild']) test(`submit says the guild decides the role from the publishing account, before it asks; a record with role ${role} is shown as it is`, async t => {
  const f = setup(t, 'Outside-Runner');
  writeFileSync(join(f.root, 'evidence.json'), JSON.stringify(f.record(role)));
  const r = await f.invoke(['submit', './evidence.json'], 'n\n');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n');
  assert.equal(lines[0], 'About to publish a PUBLIC Gist from GitHub account "Outside-Runner" with this evidence file, then send this summary to http://127.0.0.1:9/api/evidence.');
  assert.equal(lines[1], SENTENCE('Outside-Runner'));
  assert.equal(lines[2], '');
  const summary = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.indexOf('\nProceed?')));
  assert.equal(summary.role, role, 'the role is shown as the record carries it');
  assert.equal(summary.runner, 'Outside-Runner', 'the runner is the account gh is signed in to');
  assert.ok(r.stdout.endsWith('\nProceed? [y/N] '));
  assert.equal(r.stderr, 'buildguild: cancelled\n');
  assert.deepEqual(f.ghCalls(), [['api', 'user', '--jq', '.login']], 'nothing was published');
});

test('the help text says --role sets the role, a submitted one must be author or assayer and is a hint, and the guild decides at acceptance', () => {
  const r = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const pad = ' '.repeat(40);
  assert.ok(r.stdout.includes(`${pad}--rep k marks run k of several of the same build on the same trial: the evidence id and the default file name end in -rep<k>
${pad}--role <role> sets the record's role (default author). A submitted record's role must be author or assayer, and
${pad}the guild takes it only as a hint: it decides at acceptance whether the run is the author's own or a reproduction,
${pad}from the GitHub account that publishes it
  node cli/buildguild.mjs test <published-build>`), r.stdout);
  assert.ok(r.stdout.includes(`  node cli/buildguild.mjs submit <evidence.json> [--yes]
${pad}publish as a public Gist from your GitHub account and send the summary; refuses a local run and a hidden-slice record.
${pad}The guild decides at acceptance whether the record is the author's own run or a reproduction, from that account
`), r.stdout);
  // The unpublished-cases mode keeps --role guild exactly.
  assert.ok(r.stdout.includes('[--out <new-file>] [--role guild] [--max-cost-usd 5] [-j n] [--rep k] [--keep-temp]'));
});

test('cli/README.md says the same: the guild decides from the publishing account, no --role is needed, and --role is kept as given', () => {
  const readme = readFileSync(fileURLToPath(new URL('../cli/README.md', import.meta.url)), 'utf8').split('\n');
  // The whole paragraph, as one line of the file: every sentence of it is pinned.
  assert.equal(readme.filter(l => l.startsWith('The guild decides at acceptance')).length, 1);
  assert.equal(readme.find(l => l.startsWith('The guild decides at acceptance')), 'The guild decides at acceptance whether a submitted record is the build author\'s own run or a reproduction, from the GitHub account that publishes it: a run from one of the build\'s author accounts is the author\'s own, and a run from any other account is a reproduction. So run `test` as a page gives it and `submit` from your own account; you need no `--role`. The record still carries a role: `author` unless `test` or `wrap` is given `--role`, which sets it to the value given (in the unpublished-cases mode below, the role is always `guild`). `submit` shows the role and sends it; the guild refuses a submission with any role but `author` or `assayer`, and takes either of those only as a hint. The role stays so that no command and no record changes shape.');
});
