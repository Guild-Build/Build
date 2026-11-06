import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../cli/buildguild.mjs', import.meta.url));
const cliSource = fileURLToPath(new URL('../cli/', import.meta.url));

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'bg-trial-template-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const unexpectedCall = join(root, 'unexpected-call.log');
  mkdirSync(bin);
  for (const executable of ['gh', 'claude', 'bash']) {
    const stub = '#!' + process.execPath + '\n'
      + 'import { appendFileSync } from "node:fs";\n'
      + 'appendFileSync(process.env.BG_TEST_EXTERNAL_LOG, process.argv[1] + "\\n"); process.exit(23);\n';
    writeFileSync(join(bin, executable), stub, { mode: 0o700 });
  }
  const run = (args, { script = cli, emptyPath = false } = {}) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PATH: emptyPath ? join(root, 'no-bin') : bin,
      USER: 'local-author', BG_TEST_EXTERNAL_LOG: unexpectedCall },
  });
  const generate = (name, args = [], options) => run(['new', 'trial', name, ...args], options);
  const check = (name, options) => run(['check-examples', name], options);
  const noExternalCalls = () => assert.equal(existsSync(unexpectedCall), false, 'a fixture or external CLI was invoked');
  return { root, run, generate, check, noExternalCalls };
}

function expectExit(result, status) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, result.stderr + result.stdout);
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('generates and checks both trial templates offline', t => {
  const f = setup(t);
  for (const template of ['blocked-handoff', 'scoped-config-change']) {
    expectExit(f.generate(template, ['--template', template]), 0);
    const trial = join(f.root, template);
    const record = json(join(trial, 'trial.json'));
    assert.equal(record.slug, template);
    assert.equal(record.author, 'local-author');
    assert.ok(record.cases.length > 0);
    assert.ok(record.cases.every(entry => entry.name !== 'example-case'));
    const references = json(join(trial, 'reference-examples.json'));
    assert.equal(references.schema, 'buildguild.grader-examples.v1');
    assert.deepEqual(references.cases.map(entry => entry.name), record.cases.map(entry => entry.name));
    assert.equal(existsSync(join(trial, 'cases/reference-examples.json')), false);
    for (const { name, examples } of references.cases) {
      assert.deepEqual(new Set(examples.map(example => example.category)), new Set(['pass', 'fail', 'boundary']));
      assert.equal(existsSync(join(trial, 'cases', name, 'reference-examples.json')), false);
    }
    expectExit(f.check(template), 0);
    expectExit(f.run(['check', template, '--no-fixtures'], { emptyPath: true }), 0);
  }
  expectExit(f.generate('default-trial', ['--author', 'custom-author', '--license', 'MIT'], { emptyPath: true }), 0);
  const defaults = json(join(f.root, 'default-trial/trial.json'));
  assert.equal(defaults.author, 'custom-author');
  assert.equal(defaults.license, 'MIT');
  assert.deepEqual(defaults.cases, json(join(f.root, 'scoped-config-change/trial.json')).cases);
  f.noExternalCalls();
});

test('checks the actual trial grader and reports a stale expectation', t => {
  const f = setup(t);
  expectExit(f.generate('handoff-test', ['--template', 'blocked-handoff']), 0);
  const trial = join(f.root, 'handoff-test');
  const [entry] = json(join(trial, 'reference-examples.json')).cases;
  const names = Object.keys(entry.examples[0].expected);
  const paths = names.map(name => join(trial, 'cases', entry.name, 'graders', name + '.md'));
  const path = paths.find(candidate => /^type:\s*regex\s*$/m.test(readFileSync(candidate, 'utf8')));
  assert.ok(path, 'blocked handoff has a regex grader');
  const source = readFileSync(path, 'utf8');
  const broken = source.replace(/^pattern:\s*.+$/m, "pattern: '(?!)'");
  assert.notEqual(broken, source);
  writeFileSync(path, broken);
  const result = f.check('handoff-test');
  expectExit(result, 1);
  assert.match(result.stdout + result.stderr, /expect|mismatch|fail/i);
  assert.ok((result.stdout + result.stderr).includes(basename(path, '.md')));
  f.noExternalCalls();
});

test('rejects incomplete or unsafe example coverage without executing example data', async t => {
  const invalidChanges = [
    ['missing expected grader', refs => {
      delete refs.cases[0].examples[0].expected[Object.keys(refs.cases[0].examples[0].expected)[0]];
    }],
    ['unknown expected grader', refs => { refs.cases[0].examples[0].expected['nonexistent-grader'] = true; }],
    ['missing trial case coverage', refs => { refs.cases = []; }],
    ...['pass', 'fail', 'boundary'].map(category => [
      'missing ' + category + ' coverage',
      refs => { refs.cases[0].examples = refs.cases[0].examples.filter(example => example.category !== category); },
    ]),
    ['unsafe file path', refs => { refs.cases[0].examples[0].files['../outside'] = 'do not materialize'; }],
  ];
  for (const [name, modify] of invalidChanges) {
    await t.test(name, subtest => {
      const f = setup(subtest);
      expectExit(f.generate('example-test'), 0);
      const path = join(f.root, 'example-test/reference-examples.json');
      const references = json(path);
      modify(references);
      writeFileSync(path, JSON.stringify(references));
      expectExit(f.check('example-test'), 1);
      assert.equal(existsSync(join(f.root, 'outside')), false);
      f.noExternalCalls();
    });
  }
});

test('keeps an existing target intact and rejects invalid template and license options', t => {
  const f = setup(t);
  mkdirSync(join(f.root, 'existing-trial'));
  const marker = join(f.root, 'existing-trial/marker.txt');
  writeFileSync(marker, 'preserved');
  expectExit(f.generate('existing-trial'), 1);
  assert.equal(readFileSync(marker, 'utf8'), 'preserved');
  expectExit(f.generate('invalid-template', ['--template', '../wrong']), 1);
  expectExit(f.generate('invalid-license', ['--license', 'Not-A-License']), 1);
  assert.equal(existsSync(join(f.root, 'invalid-template')), false);
  assert.equal(existsSync(join(f.root, 'invalid-license')), false);
  f.noExternalCalls();
});

test('ships template assets and the example checker in the offline npm package', t => {
  const f = setup(t);
  const copy = join(f.root, 'package-source');
  cpSync(cliSource, copy, { recursive: true, filter: path => basename(path) !== 'dist' });
  const options = { cwd: copy, encoding: 'utf8', timeout: 20_000 };
  const pack = spawnSync('npm', ['pack', '--offline', '--json'], options);
  expectExit(pack, 0);
  const [{ filename }] = JSON.parse(pack.stdout);
  const unpack = spawnSync('tar', ['-xzf', filename], options);
  expectExit(unpack, 0);
  const script = join(copy, 'package/dist/cli/buildguild.mjs');
  expectExit(f.generate('packaged-trial', ['--template', 'blocked-handoff'], { script }), 0);
  expectExit(f.check('packaged-trial', { script }), 0);
  f.noExternalCalls();
});

test('treats reference tool inputs as data even when they contain shell commands', t => {
  const f = setup(t);
  expectExit(f.generate('data-only'), 0);
  const path = join(f.root, 'data-only/reference-examples.json');
  const references = json(path);
  const marker = join(f.root, 'example-executed');
  references.cases[0].examples[0].toolCalls.push({ name: 'Bash', inputText: JSON.stringify({ command: 'touch "' + marker + '"' }) });
  writeFileSync(path, JSON.stringify(references));
  expectExit(f.check('data-only'), 0);
  assert.equal(existsSync(marker), false);
  f.noExternalCalls();
});

test('the bundled fixtures create the starting conditions described by the templates', t => {
  const f = setup(t);
  for (const template of ['blocked-handoff', 'scoped-config-change']) {
    expectExit(f.generate(template, ['--template', template]), 0);
    const [entry] = json(join(f.root, template, 'trial.json')).cases;
    const workspace = join(f.root, template + '-workspace');
    mkdirSync(workspace);
    const fixture = join(f.root, template, 'cases', entry.name, 'fixture.sh');
    const options = { cwd: workspace, encoding: 'utf8', timeout: 10_000 };
    expectExit(spawnSync('/bin/bash', [fixture], options), 0);
    if (template === 'blocked-handoff') {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ['--test'], { ...options, env });
      expectExit(result, 1);
      assert.match(result.stderr + result.stdout, /ERR_MODULE_NOT_FOUND/);
      assert.match(result.stderr + result.stdout, /left-pad-but-not-installed/);
    } else {
      assert.match(readFileSync(join(workspace, 'service.conf'), 'utf8'), /^retry_limit=2$/m);
      assert.equal(readFileSync(join(workspace, 'NOTICE.txt'), 'utf8'), 'Do not edit this file.\n');
    }
  }
  f.noExternalCalls();
});

test('keeps authored expectations outside the tasks shown for comparison', t => {
  const f = setup(t);
  expectExit(f.generate('review-trial'), 0);
  const current = fileURLToPath(new URL('../bundles/measured-delivery', import.meta.url));
  const candidate = fileURLToPath(new URL('../bundles/evidence-first-review', import.meta.url));
  expectExit(f.run(['prepare', current, candidate, '--trial', 'review-trial',
    '--model', 'test-model', '--max-cost-usd', '1', '--out', 'review']), 0);
  const plan = json(join(f.root, 'review/plan.json'));
  assert.ok(plan.tasks[0].graders.length > 0);
  assert.doesNotMatch(JSON.stringify(plan.tasks), /correct-change|buildguild\.grader-examples\.v1/);
  assert.equal(existsSync(join(f.root, 'review/inputs/trial/cases/reference-examples.json')), false);
  f.noExternalCalls();
});

test('rejects hidden or unsupported grading configuration before checking examples', async t => {
  for (const [name, change] of [
    ['inline grader and prompt override', caseDir => {
      const path = join(caseDir, 'case.yaml');
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source + '\nexecution:\n  append_system_prompt: Replace the reviewed prompt\ngraders:\n  - type: llm\n');
    }],
    ['missing prompt', caseDir => rmSync(join(caseDir, 'prompt.md'))],
    ['unsupported grader type', caseDir => {
      const path = join(caseDir, 'graders/notice-preserved.md');
      writeFileSync(path, '---\ntype: llm\n---\n');
    }],
    ['unknown grader option', caseDir => {
      const path = join(caseDir, 'graders/notice-preserved.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace('---\n', '---\nunknown_option: true\n'));
    }],
  ]) {
    await t.test(name, subtest => {
      const f = setup(subtest);
      expectExit(f.generate('hidden-config'), 0);
      const trial = join(f.root, 'hidden-config');
      const [entry] = json(join(trial, 'trial.json')).cases;
      change(join(trial, 'cases', entry.name));
      expectExit(f.check('hidden-config'), 1);
      f.noExternalCalls();
    });
  }
});
