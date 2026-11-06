// Data-only checks for a documented subset of Claude Code's deterministic
// graders. No fixture execution, trace replay, shell, provider or network access.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateComparisonCase } from './comparison-inputs.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, message) => { if (!condition) throw Error(message); };
const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const keys = (value, allowed, where) => {
  need(object(value), `${where}: expected an object`);
  need(Object.keys(value).every(key => allowed.includes(key)), `${where}: unsupported field`);
};
const sameNames = (actual, expected) => actual.length === expected.length && new Set(actual).size === actual.length && actual.every(name => expected.includes(name));
function literalPath(value) {
  need(typeof value === 'string' && value.length > 0 && value === value.trim() && !/[\\*?\[\]{}\u0000\r\n]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..') && !/^[A-Za-z]:/.test(value),
  'file paths must be relative literal paths without globs or traversal');
  return value;
}
function entry(root, relative, directory = false) {
  literalPath(relative);
  let path = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]);
    const st = lstatSync(path);
    need(index < parts.length - 1 || directory ? st.isDirectory() : st.isFile(), `${relative}: links and special files are unsupported`);
  }
  return path;
}
const read = (root, relative) => readFileSync(entry(root, relative), 'utf8');

function scalar(value) {
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith('"')) {
    const parsed = JSON.parse(value);
    need(typeof parsed === 'string', 'double-quoted values must be strings');
    return parsed;
  }
  need(/^[A-Za-z0-9_./-]+$/.test(value), 'use a single-line quoted string or plain scalar; advanced YAML is unsupported');
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^null$/i.test(value)) return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    need(Number.isFinite(number), 'numeric values must be finite');
    return number;
  }
  need(!/^[-+]?(?:\d|\.\d)/.test(value) && !/^[-+]?\.(?:inf|nan)$/i.test(value), 'unsupported numeric scalar; quote strings or use finite decimal numbers');
  return value;
}

export function parseExampleGrader(markdown) {
  const front = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  need(front !== undefined, 'grader needs Markdown front matter');
  const fields = {};
  let targetBlock = false;
  for (const line of front.split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const nested = line.match(/^  (source|path):[ ]*(.+)$/);
    if (nested) {
      need(targetBlock && !Object.hasOwn(fields.target, nested[1]), 'invalid or duplicate target field');
      fields.target[nested[1]] = scalar(nested[2].trimEnd());
      continue;
    }
    const top = line.match(/^([a-z_]+):[ ]*(.*)$/);
    need(top && !Object.hasOwn(fields, top[1]), 'unsupported YAML syntax or duplicate grader field');
    const [, key, raw] = top;
    need(['type', 'pattern', 'flags', 'match', 'target', 'path', 'exists', 'tool', 'input_match', 'min', 'max', 'weight', 'arm'].includes(key), `unsupported grader field: ${key}`);
    targetBlock = key === 'target' && raw.trim() === '';
    fields[key] = targetBlock ? {} : scalar(raw.trimEnd());
  }
  const allowed = {
    regex: ['type', 'pattern', 'flags', 'match', 'target', 'weight', 'arm'],
    file_exists: ['type', 'path', 'exists', 'weight', 'arm'],
    tool_used: ['type', 'tool', 'input_match', 'min', 'max', 'weight', 'arm'],
  };
  need(Object.hasOwn(allowed, fields.type ?? ''), 'only regex, file_exists and tool_used graders are supported');
  need(Object.keys(fields).every(key => allowed[fields.type].includes(key)), 'field is unsupported for this grader type');
  if (fields.arm !== undefined) need(fields.arm === 'both', 'only arm: both is supported in reference examples');
  if (fields.weight !== undefined) need(typeof fields.weight === 'number' && Number.isFinite(fields.weight) && fields.weight > 0, 'weight must be a positive number');
  if (fields.type === 'regex') {
    need(typeof fields.pattern === 'string', 'regex needs pattern');
    need(fields.flags === undefined || typeof fields.flags === 'string', 'regex flags must be a string');
    const target = fields.target === undefined ? 'last_message' : fields.target;
    if (target !== 'last_message') {
      need(object(target) && target.source === 'file' && typeof target.path === 'string', 'regex target must be last_message or a literal file');
      literalPath(target.path);
    }
    need(['contains', 'not_contains'].includes(fields.match === undefined ? 'contains' : fields.match), 'only contains and not_contains regex matching are supported');
    new RegExp(fields.pattern, fields.flags ?? ''); // Validate using the local Node engine.
    return { ...fields, target };
  }
  if (fields.type === 'file_exists') {
    literalPath(fields.path);
    need(fields.exists === undefined || typeof fields.exists === 'boolean', 'exists must be an unquoted boolean');
    return { ...fields, exists: fields.exists === undefined ? true : fields.exists };
  }
  need(typeof fields.tool === 'string' && /^[A-Za-z0-9_-]+$/.test(fields.tool), 'tool must be a literal tool name');
  if (fields.input_match !== undefined) {
    need(typeof fields.input_match === 'string', 'input_match must be a string');
    new RegExp(fields.input_match);
  }
  const min = fields.min === undefined ? 1 : fields.min;
  const max = fields.max === undefined ? Infinity : fields.max;
  need(Number.isSafeInteger(min) && min >= 0 && (fields.max === undefined || Number.isSafeInteger(max)) && max >= min, 'invalid tool count bounds');
  return { ...fields, min, max };
}

export function evaluateExampleGrader(grader, example) {
  // In the supported runner this predicate matches changed-file paths, not a
  // complete workspace inventory. Reference outcomes keep that input separate.
  if (grader.type === 'file_exists') return example.changedFiles.includes(grader.path) === grader.exists;
  if (grader.type === 'tool_used') {
    const count = example.toolCalls.filter(call => call.name === grader.tool
      && (grader.input_match === undefined || new RegExp(grader.input_match).test(call.inputText))).length;
    return count >= grader.min && count <= grader.max;
  }
  let text = example.lastMessage;
  if (grader.target !== 'last_message') {
    // A missing file is a failure even for not_contains, matching the runner.
    if (!Object.hasOwn(example.files, grader.target.path)) return false;
    text = example.files[grader.target.path];
  }
  const matched = new RegExp(grader.pattern, grader.flags ?? '').test(text);
  return grader.match === 'not_contains' ? !matched : matched;
}

function validateExample(example, graderNames, where) {
  keys(example, ['id', 'description', 'category', 'lastMessage', 'files', 'changedFiles', 'toolCalls', 'expected'], where);
  need(slug(example.id) && typeof example.description === 'string' && example.description.trim(), `${where}: example needs id and description`);
  need(['pass', 'fail', 'boundary'].includes(example.category), `${where}: category must be pass, fail or boundary`);
  need(typeof example.lastMessage === 'string' && object(example.files) && Array.isArray(example.changedFiles)
    && Array.isArray(example.toolCalls), `${where}: provide lastMessage, files, changedFiles and toolCalls`);
  example.changedFiles.forEach(literalPath);
  need(new Set(example.changedFiles).size === example.changedFiles.length, `${where}: duplicate changed-file paths`);
  for (const [path, text] of Object.entries(example.files)) {
    literalPath(path);
    need(typeof text === 'string', `${where}: file contents must be text`);
  }
  for (const call of example.toolCalls) {
    keys(call, ['name', 'inputText'], where);
    need(typeof call.name === 'string' && call.name && typeof call.inputText === 'string', `${where}: tool calls need name and inputText`);
    need(object(JSON.parse(call.inputText)), `${where}: inputText must be a JSON-serialized tool input object`);
  }
  need(object(example.expected) && sameNames(Object.keys(example.expected), graderNames)
    && Object.values(example.expected).every(value => typeof value === 'boolean'), `${where}: expected must name every actual grader exactly once with a boolean`);
  const accepted = Object.values(example.expected).every(Boolean);
  need(example.category !== 'pass' || accepted, `${where}: a pass example must expect all graders to pass`);
  need(example.category !== 'fail' || !accepted, `${where}: a fail example must expect a failed grader`);
}

export function checkExamples(folder) {
  need(lstatSync(resolve(folder)).isDirectory(), 'trial must be a regular directory');
  const root = realpathSync(folder);
  const trial = JSON.parse(read(root, 'trial.json'));
  const corpus = JSON.parse(read(root, 'reference-examples.json'));
  keys(corpus, ['schema', 'cases'], 'reference examples');
  need(corpus.schema === 'buildguild.grader-examples.v1' && Array.isArray(corpus.cases), 'unsupported reference examples schema');
  need(Array.isArray(trial.cases) && trial.cases.length && trial.cases.every(row => slug(row?.name)), 'trial needs named cases');
  const caseNames = trial.cases.map(row => row.name);
  const actualCases = readdirSync(entry(root, 'cases', true));
  need(new Set(caseNames).size === caseNames.length && sameNames(actualCases, caseNames)
    && sameNames(corpus.cases.map(row => row?.name), caseNames), 'trial, case directories and reference examples must have the same case roster');
  const result = { ok: true, cases: caseNames.length, examples: 0, assertions: 0, plannedAssertions: 0, failures: [] };
  for (const row of corpus.cases) {
    try {
      keys(row, ['name', 'examples'], row.name);
      const caseDirectory = entry(root, `cases/${row.name}`, true);
      entry(root, `cases/${row.name}/prompt.md`);
      if (existsSync(join(caseDirectory, 'case.yaml'))) entry(root, `cases/${row.name}/case.yaml`);
      validateComparisonCase(caseDirectory, row.name);
      const directory = `cases/${row.name}/graders`;
      const files = readdirSync(entry(root, directory, true)).filter(name => name.endsWith('.md')).sort();
      need(files.length, `${row.name}: no graders`);
      const names = files.map(name => name.slice(0, -3));
      need(Array.isArray(row.examples) && row.examples.length, `${row.name}: no examples`);
      for (const example of row.examples) validateExample(example, names, `${row.name}/${example?.id ?? '?'}`);
      need(new Set(row.examples.map(example => example.id)).size === row.examples.length, `${row.name}: duplicate example ids`);
      for (const category of ['pass', 'fail', 'boundary']) need(row.examples.some(example => example.category === category), `${row.name}: needs a ${category} example`);
      for (const name of names) need(row.examples.some(example => example.expected[name]) && row.examples.some(example => !example.expected[name]), `${row.name}/${name}: needs passing and failing examples`);
      const graders = files.map((file, index) => {
        try { return parseExampleGrader(read(root, `${directory}/${file}`)); }
        catch (error) { result.failures.push(`${row.name}/${names[index]}: ${error.message}`); return null; }
      });
      result.examples += row.examples.length;
      result.plannedAssertions += row.examples.length * names.length;
      for (const example of row.examples) for (let i = 0; i < graders.length; i++) {
        if (!graders[i]) continue;
        const actual = evaluateExampleGrader(graders[i], example);
        result.assertions++;
        if (actual !== example.expected[names[i]]) result.failures.push(`${row.name}/${example.id}/${names[i]}: expected ${example.expected[names[i]] ? 'pass' : 'fail'}, got ${actual ? 'pass' : 'fail'}`);
      }
    } catch (error) { result.failures.push(`${row.name}: ${error.message}`); }
  }
  result.ok = result.failures.length === 0;
  return result;
}
