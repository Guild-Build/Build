// One ceiling for the whole Season trial run: the plan (.github/scripts/plan-trial-runs.mjs) keeps a reserve of each
// request's max_cost_usd for the key check and gives the trial the rest, and trial.yml hands each share to the call it
// bounds. Nothing here calls a model or the network: the plan is called directly, and the workflow's own shell lines run
// against a stub claude or a stub node.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { KEY_CHECK_BUDGET_USD, KEY_CHECK_CALLS, KEY_CHECK_RESERVE_USD, MIN_CEILING_USD, planRuns, PlanError, trialBudget } from '../.github/scripts/plan-trial-runs.mjs';

const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/trial.yml', import.meta.url)), 'utf8');
const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
const plan = (requests, options = {}) => planRuns(requests, { buildExists: slug => ['measured-delivery', 'lean-start'].includes(slug), ...options });
const where = 'request 1 in .github/trial-queue.json';
const tooLow = at => `${at}: max_cost_usd must be at least 0.51 USD, the smallest usable ceiling: each ceiling keeps 0.5 USD for the key check and gives the trial the rest`;

// A step of the trial job as written, its env, and its run lines as its shell sees them.
const stepText = name => {
  const start = workflow.indexOf(`\n      - name: ${name}\n`);
  assert.ok(start >= 0, `no step named ${name}`);
  const end = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start + 1, end < 0 ? undefined : end + 1);
};
const envOf = name => {
  const text = stepText(name);
  const start = text.indexOf('        env:\n');
  assert.ok(start >= 0, `${name} has no env`);
  const vars = {};
  for (const line of text.slice(start + '        env:\n'.length).split('\n')) {
    const m = line.match(/^ {10}([A-Z_]+): (.+)$/);
    if (!m) break;
    vars[m[1]] = m[2];
  }
  return vars;
};
const runLines = name => {
  const text = stepText(name);
  const body = text.slice(text.indexOf('        run: |\n') + '        run: |\n'.length);
  return body.split('\n').map(line => line.slice(10)).join('\n');
};
const KEY_CHECK = 'Check the key works with one tiny call';
const RUN = 'Run the trial';

test('the reserve is the key checks\' budgets together, and the trial gets exactly the ceiling less the reserve', () => {
  assert.deepEqual([KEY_CHECK_BUDGET_USD, KEY_CHECK_CALLS, KEY_CHECK_RESERVE_USD, MIN_CEILING_USD], ['0.25', 2, '0.5', '0.51']);
  for (const [ceiling, trial] of [['3', '2.5'], ['5', '4.5'], ['1', '0.5'], ['0.51', '0.01'], ['0.5100', '0.01'], ['2.345', '1.845'], ['10.10', '9.6'], ['003', '2.5'], ['7.75', '7.25'], ['1000000', '999999.5'], ['0.6000000000000001', '0.1000000000000001']]) {
    assert.equal(trialBudget(ceiling), trial, `ceiling ${ceiling}`);
  }
  for (const ceiling of ['0.5', '0.50', '0.509', '0.25', '0.1', '0.0001']) assert.equal(trialBudget(ceiling), null, `ceiling ${ceiling}`);
  // Counted independently, in whole 10^-20 dollars: two key checks' budgets and the trial's share add up to the ceiling.
  const exact = amount => { const [whole, part = ''] = amount.split('.'); return BigInt(whole + part.padEnd(20, '0')); };
  for (let cents = 51; cents <= 2500; cents += 7) {
    const ceiling = (cents / 100).toFixed(2);
    assert.equal(exact(KEY_CHECK_BUDGET_USD) * BigInt(KEY_CHECK_CALLS) + exact(trialBudget(ceiling)), exact(ceiling), `ceiling ${ceiling}`);
  }
});

test('a run that spends carries both budgets, every repeat the same, and a verify-only run carries neither', () => {
  const { matrix } = plan([
    { build: 'measured-delivery', trial: 'client-deployment-v1', max_cost_usd: 3, repeat: 5 },
    { build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: '2.345' },
    { build: 'lean-start', trial: 'calibration-shell-v1', max_cost_usd: 0.25, verify_only: true },
  ]);
  assert.deepEqual(matrix.map(m => [m.key_check_budget_usd, m.trial_budget_usd]), [...Array(5).fill(['0.25', '2.5']), ['0.25', '1.845'], [undefined, undefined]]);
  assert.deepEqual(Object.keys(matrix[6]), ['build', 'trial', 'max_cost_usd', 'model', 'concurrency', 'verify_only']);
  // The ceiling itself stays in the entry, as the queue gave it.
  assert.deepEqual(matrix.map(m => m.max_cost_usd), [...Array(5).fill('3'), '2.345', '0.25']);
});

test('a ceiling that would leave the trial nothing is refused, naming the smallest usable ceiling', () => {
  for (const max_cost_usd of [0.5, '0.5', '0.50', 0.25, 0.509, '0.0001']) {
    assert.throws(() => plan([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd }]), err => err instanceof PlanError && err.message === tooLow(where), `max_cost_usd ${max_cost_usd}`);
  }
  assert.throws(() => plan([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: '0.5', verify_only: 'false' }], { dispatched: true }), err => err.message === tooLow('the dispatch inputs'));
  // It is checked in queue order, like every other refusal: the first request's low ceiling before the second's typo.
  assert.throws(() => plan([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: 0.4 }, { build: 'lean-start', trial: 'calibration-shell-v1', colour: 'red' }]), err => err.message === tooLow(where));
  assert.equal(plan([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: 0.51 }]).matrix[0].trial_budget_usd, '0.01');
  // A verify-only request calls no model, so its ceiling is neither split nor refused; a ceiling that is not a positive
  // number keeps its own message.
  assert.equal(plan([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: 0.25, verify_only: true }]).matrix.length, 1);
  assert.throws(() => plan([{ build: 'lean-start', trial: 'guild-smoke-v1', max_cost_usd: 0 }]), err => err.message === `${where}: max_cost_usd must be a positive number of US dollars`);
});

test('the summary says what a ceiling covers and how it is split, and a verify-only plan still says it runs nothing', () => {
  const split = "A ceiling covers every paid call of its run. The key check keeps 0.5 USD of it: one tiny call, or two when the key is organisation-level, each with a budget of 0.25 USD, and a check that reaches its budget stops the run before the trial. The trial gets the rest. Claude Code holds each budget to its own cost estimate, and a reply or agent run already under way when a budget is reached still finishes, so a run can pass its ceiling by that much.";
  // The pilot's request as queued in Guild-Build/Build#13.
  assert.deepEqual(plan([{ build: 'measured-delivery', trial: 'client-deployment-v1', max_cost_usd: 3, model: 'claude-sonnet-5-5' }]).summary, [
    '| Build | Trial | Model | Ceiling | Trial budget |',
    '|---|---|---|---|---|',
    '| measured-delivery | client-deployment-v1 | claude-sonnet-5-5 | 3 USD | 2.5 USD |',
    '',
    "Each run waits for the owner's approval in the trials environment. Ceilings total 3 USD.",
    '',
    split,
  ]);
  const repeated = plan([{ build: 'measured-delivery', trial: 'client-deployment-v1', max_cost_usd: 3, repeat: 5 }]).summary;
  assert.equal(repeated[2], '| measured-delivery | client-deployment-v1 | claude-sonnet-5-5 | 3 USD | 2.5 USD | 5 |');
  assert.match(repeated[4], /Ceilings total 15 USD, each ceiling times its repeats\.$/);
  assert.equal(repeated[6], split.replace('The trial gets the rest.', 'The trial gets the rest, the same on every repeat.'));
  // Nothing here spends, so there is no split to explain.
  assert.deepEqual(plan([{ build: 'lean-start', trial: 'guild-smoke-v1', verify_only: true }]).summary, [
    '| Build | Trial | Model | Ceiling | Trial budget |',
    '|---|---|---|---|---|',
    '| lean-start | guild-smoke-v1 | claude-sonnet-5-5 | verify only, runs nothing | none |',
    '',
    "Each run waits for the owner's approval in the trials environment. Ceilings total 0 USD.",
  ]);
});

test('every claude call in the trial job has a budget: each key check its own, the trial its share of the ceiling', () => {
  const job = workflow.slice(workflow.indexOf('\n  trial:\n'));
  const commands = job.split('\n').filter(line => !/^\s*#/.test(line)).flatMap(line => [...line.matchAll(/(?:^|[\s;&|(])claude(?=\s)(.*)$/g)].map(m => m[1]));
  // claude --version prints the version and calls no model; every other call is a key check with its budget.
  assert.deepEqual(commands.map(rest => rest.startsWith(' --version') ? 'version' : rest.startsWith(' -p ') ? 'check' : rest), ['version', 'check']);
  for (const rest of commands.filter(c => c.startsWith(' -p '))) assert.match(rest, / --max-turns 1 --max-budget-usd "\$BG_KEY_CHECK_BUDGET_USD" 2>&1\)/);
  const trials = job.split('\n').filter(line => /node cli\/buildguild\.mjs test /.test(line));
  assert.equal(trials.length, 1);
  assert.match(trials[0], / --max-cost-usd "\$BG_TRIAL_BUDGET_USD" /);
  // Each step reads its budget from the field the plan writes, and nothing reads the whole ceiling any more.
  assert.equal(envOf(KEY_CHECK).BG_KEY_CHECK_BUDGET_USD, '${{ matrix.key_check_budget_usd }}');
  assert.equal(envOf(RUN).BG_TRIAL_BUDGET_USD, '${{ matrix.trial_budget_usd }}');
  const written = new Set(plan([{ build: 'lean-start', trial: 'guild-smoke-v1', repeat: 2 }, { build: 'measured-delivery', trial: 'guild-smoke-v1', verify_only: true }]).matrix.flatMap(Object.keys));
  const read = new Set([...workflow.matchAll(/\bmatrix\.([a-z_]+)/g)].map(m => m[1]));
  assert.deepEqual([...read].filter(field => !written.has(field)), []);
  assert.ok(read.has('key_check_budget_usd') && read.has('trial_budget_usd') && !read.has('max_cost_usd'));
  // A verify-only run still installs nothing, checks no key and runs no trial.
  for (const name of ['Install Claude Code and the Linux sandbox backend it needs for Bash-granting runs', KEY_CHECK, RUN]) {
    assert.match(stepText(name), /^ {8}if: \$\{\{ matrix\.verify_only != 'true' \}\}$/m, name);
  }
});

// A stub claude that logs each call and answers from STUB_REPLIES, one [output, exit status] pair per call.
const stub = `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const log = process.env.STUB_LOG;
const done = readFileSync(log, 'utf8').split('\\n').filter(Boolean).length;
appendFileSync(log, JSON.stringify({ args: process.argv.slice(2), header: process.env.ANTHROPIC_CUSTOM_HEADERS ?? null }) + '\\n');
const [out, status] = JSON.parse(process.env.STUB_REPLIES)[done] ?? ['no reply planned for this call', 99];
console.log(out);
process.exit(status);
`;

test('the key check stops the job before the trial unless a call within its budget shows the key works', t => {
  const root = mkdtempSync(join(tmpdir(), 'bg-key-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'claude'), stub, { mode: 0o700 });
  const step = runLines(KEY_CHECK);
  const check = (replies, env = {}) => {
    for (const f of ['calls.log', 'github_env']) writeFileSync(join(root, f), '');
    const r = spawnSync('bash', ['-e', '-c', step], { cwd: root, encoding: 'utf8', env: { PATH: `${root}:${process.env.PATH}`, BG_MODEL: 'claude-sonnet-5-5', BG_KEY_CHECK_BUDGET_USD: KEY_CHECK_BUDGET_USD, GITHUB_ENV: join(root, 'github_env'), STUB_LOG: join(root, 'calls.log'), STUB_REPLIES: JSON.stringify(replies), ...env } });
    const calls = readFileSync(join(root, 'calls.log'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    return { status: r.status, said: r.stdout + r.stderr, calls, githubEnv: readFileSync(join(root, 'github_env'), 'utf8') };
  };
  const ok = ['ok', 0];
  // What Claude Code 2.1.321 printed, with exit status 1, for a one-turn call whose budget was too small for its reply.
  const budget = ['Error: Exceeded USD budget (0.25)', 1];
  // Lines holding the phrases the step looks for; the stub's other words are made up.
  const orgLevel = ['API Error: 400 this key is not scoped to a workspace', 1];
  const apiError = ['API Error: 401 the key was refused', 1];
  const loggedOut = ['Not logged in · Please run /login', 1];
  const other = ['Error: the call stopped for another reason', 3];
  const ws = { BG_WORKSPACE_ID: 'ws-test' };
  const header = 'ANTHROPIC_CUSTOM_HEADERS=anthropic-workspace-id: ws-test\n';
  for (const c of [
    { name: 'a working key', replies: [ok], status: 0, calls: 1 },
    { name: 'a check that reaches its budget', replies: [budget], status: 1, calls: 1, says: 'the key check reached its budget of 0.25 USD before the key was shown to work; stopping before any trial run' },
    // The JSON result's wording of the same stop, in case a later Claude Code prints that instead.
    { name: 'the budget in the result wording', replies: [['Reached maximum budget ($0.25)', 1]], status: 1, calls: 1, says: 'the key check reached its budget of 0.25 USD' },
    { name: 'an API error', replies: [apiError], status: 1, calls: 1, says: 'the key does not work; stopping before any trial run' },
    { name: 'no login', replies: [loggedOut], status: 1, calls: 1, says: 'the key does not work; stopping before any trial run' },
    { name: 'any other error', replies: [other], status: 1, calls: 1, says: 'the key check ended in an error (exit status 3); stopping before any trial run' },
    { name: 'an organisation-level key', env: ws, replies: [orgLevel, ok], status: 0, calls: 2, githubEnv: header },
    { name: 'an organisation-level key and no workspace id', replies: [orgLevel], status: 1, calls: 1, says: 'organisation-level key and no workspace id in the vault; stopping' },
    { name: 'a retry that reaches its budget', env: ws, replies: [orgLevel, budget], status: 1, calls: 2, says: 'the key check reached its budget of 0.25 USD' },
    { name: 'a retry with an API error', env: ws, replies: [orgLevel, apiError], status: 1, calls: 2, says: 'the key does not work with the header either; stopping' },
    { name: 'a retry with any other error', env: ws, replies: [orgLevel, other], status: 1, calls: 2, says: 'the key check with the header ended in an error (exit status 3); stopping before any trial run' },
  ]) {
    const r = check(c.replies, c.env);
    assert.equal(r.status, c.status, `${c.name}: ${r.said}`);
    assert.equal(r.calls.length, c.calls, c.name);
    assert.ok(r.calls.length <= KEY_CHECK_CALLS, c.name);
    if (c.says) assert.ok(r.said.includes(c.says), `${c.name}: ${r.said}`);
    // The output is shown, and only a key shown to work with the header passes the header on to the run.
    assert.ok(r.said.startsWith(`${c.replies[0][0]}\n`), c.name);
    assert.equal(r.githubEnv, c.githubEnv ?? '', c.name);
    for (const [i, call] of r.calls.entries()) {
      assert.deepEqual(call.args, ['-p', 'Reply with the single word ok.', '--model', 'claude-sonnet-5-5', '--max-turns', '1', '--max-budget-usd', KEY_CHECK_BUDGET_USD], `${c.name}, call ${i + 1}`);
      assert.equal(call.header, i === 0 ? null : 'anthropic-workspace-id: ws-test', `${c.name}, call ${i + 1}`);
    }
  }
  // Without a budget from the plan the step calls nothing.
  const none = check([ok], { BG_KEY_CHECK_BUDGET_USD: '' });
  assert.equal(none.status, 1);
  assert.equal(none.calls.length, 0);
  assert.equal(none.said, 'the plan gave the key check no budget; stopping before any trial run\n');
});

test('the run step gives the trial its share of the ceiling, and runs nothing without one', t => {
  const root = mkdtempSync(join(tmpdir(), 'bg-trial-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'node'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n', { mode: 0o700 });
  const step = runLines(RUN);
  // BG_MAX_COST_USD is set only to show that the step does not read the whole ceiling.
  const run = budget => spawnSync('bash', ['-e', '-c', step], { cwd: root, encoding: 'utf8', env: { PATH: `${root}:${process.env.PATH}`, RUNNER_TEMP: root, BG_BUILD: 'lean-start', BG_TRIAL: 'guild-smoke-v1', BG_TRIAL_BUDGET_USD: budget, BG_MAX_COST_USD: '3', BG_MODEL: 'claude-sonnet-5-5', BG_CONCURRENCY: '1', BG_REP: '' } });
  const shared = run(trialBudget('3'));
  assert.equal(shared.status, 0, shared.stderr);
  const args = shared.stdout.trim().split('\n');
  assert.deepEqual(args.slice(args.indexOf('--max-cost-usd'), args.indexOf('--max-cost-usd') + 2), ['--max-cost-usd', '2.5']);
  assert.ok(!args.includes('3'));
  const none = run('');
  assert.equal(none.status, 1);
  assert.equal(none.stdout, 'the plan gave the trial no budget; stopping\n');
});

test('the dispatch input, the workflow header and the README give the split the plan uses', () => {
  const flat = text => text.replace(/\n# ?/g, ' ').replace(/\s+/g, ' ');
  assert.equal(workflow.match(/\n {6}max_cost_usd:\n {8}description: ([^\n]+)\n/)[1],
    `Cost ceiling in USD for everything the run spends, at least ${MIN_CEILING_USD}; the key check keeps ${KEY_CHECK_RESERVE_USD} of it and the trial gets the rest`);
  assert.ok(flat(workflow.slice(0, workflow.indexOf('\non:'))).includes(`A request's cost ceiling, max_cost_usd, covers every paid call of its run. The plan keeps ${KEY_CHECK_RESERVE_USD} USD of it for the key check, one tiny call (two when the key is organisation-level) with a budget of ${KEY_CHECK_BUDGET_USD} USD each, and gives the trial the rest.`));
  const season = flat(readme.slice(readme.indexOf('## Season trials')));
  for (const words of [`each check has a budget of ${KEY_CHECK_BUDGET_USD} USD`, `So ${KEY_CHECK_RESERVE_USD} USD of each ceiling is kept for the check and the trial gets the rest: a 3 USD ceiling gives the trial ${trialBudget('3')} USD`, `refuses a ceiling below ${MIN_CEILING_USD} USD`]) {
    assert.ok(season.includes(words), words);
  }
});
