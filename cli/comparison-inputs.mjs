import { readFileSync, readdirSync, lstatSync, statSync, realpathSync, mkdirSync, chmodSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';

const inside = (a, b) => a === b || a.startsWith(b + sep);
const overlap = (a, b) => inside(a, b) || inside(b, a);
const json = p => JSON.parse(readFileSync(p, 'utf8'));
export const inputLabels = ['incumbent', 'candidate', 'trial'];
export const budgetAllocation = total => Math.floor(total * 500000) / 1000000;

export function parseComparisonArgs(args) {
  const options = {}, paths = [];
  const allowed = new Set(['trial', 'model', 'max-cost-usd', 'out', 'runs']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) { paths.push(arg); continue; }
    const key = arg.slice(2);
    if (!arg.startsWith('--') || !allowed.has(key)) throw Error(`unsupported compare option: ${arg}`);
    if (key in options || !args[i + 1] || args[i + 1].startsWith('-')) throw Error(`${arg} needs exactly one value`);
    options[key] = args[++i];
  }
  if (paths.length !== 2) throw Error('compare needs the current and candidate build folders');
  for (const key of ['trial', 'model', 'max-cost-usd', 'out']) if (!options[key]) throw Error(`compare requires --${key}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._\[\]-]*$/.test(options.model)) throw Error('--model must be an explicit model id');
  if (!/^\d+(\.\d+)?$/.test(options['max-cost-usd']) || !Number.isFinite(Number(options['max-cost-usd'])) || Number(options['max-cost-usd']) < 0.000002) throw Error('--max-cost-usd must be a positive total of at least 0.000002 USD');
  const runs = options.runs ?? '3';
  if (!/^[1-9]\d*$/.test(runs) || !Number.isSafeInteger(Number(runs)) || Number(runs) > 100) throw Error('--runs must be a whole number from 1 to 100');
  return { ...options, runs: Number(runs), total: Number(options['max-cost-usd']), paths };
}

// Reject links before reading content. A local comparison never imports a repository's .git or old eval output.
export function inventory(root, build = false, prefix = '', excludeGit = false) {
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    if (!prefix && ((excludeGit && name === '.git') || (build && name === 'evals'))) return [];
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = lstatSync(join(root, rel));
    if (st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) throw Error(`only regular files and directories are allowed: ${rel}`);
    if (['.env', '.env.local', 'credentials.json', 'id_rsa', 'id_ed25519'].includes(name)) throw Error(`remove credential file from comparison input: ${rel}`);
    if (st.isDirectory()) return inventory(root, build, rel, excludeGit);
    return { rel, mode: st.mode & 0o111 ? 0o755 : 0o644 };
  });
}

export function snapshot(source, dest, files) {
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const { rel, mode } of files) {
    // Recheck against links changed after inventory.
    const src = join(source, rel);
    if (!inside(realpathSync(src), source) || !lstatSync(src).isFile()) throw Error(`input changed during snapshot: ${rel}`);
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(src, target);
    chmodSync(target, mode);
  }
}

export function treeHash(root) {
  const h = createHash('sha256');
  for (const { rel, mode } of inventory(root)) {
    const bytes = readFileSync(join(root, rel));
    h.update(JSON.stringify([rel, mode, bytes.length]) + '\n');
    h.update(bytes);
  }
  return h.digest('hex');
}

// Comparison supports the small scaffold-metadata format used by the local
// authoring template. Consuming every line prevents hidden inline graders or
// YAML merge/alias rules from changing the reviewed acceptance checks.
export function validateComparisonCase(caseDir, name) {
  if (!existsSync(join(caseDir, 'prompt.md'))) throw Error(`${name}: comparison requires prompt.md; put task execution settings there and graders in graders/*.md.`);
  const yamlPath = join(caseDir, 'case.yaml');
  if (!existsSync(yamlPath)) return;
  const seen = new Set();
  let inContext = false;
  const fail = () => { throw Error(`${name}: comparison case.yaml supports only schema_version: "1.1", a matching name, and context.scaffold_script. Use prompt.md for execution settings and graders/*.md for deterministic checks; inline graders and advanced YAML are unsupported.`); };
  for (const raw of readFileSync(yamlPath, 'utf8').split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(raw)) continue;
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    const top = line.match(/^(schema_version|name):[ ]*(?:"([A-Za-z0-9_.-]+)"|'([A-Za-z0-9_.-]+)'|([A-Za-z0-9_.-]+))$/);
    if (top) {
      const [, key, double, single, plain] = top;
      const value = double ?? single ?? plain;
      if (seen.has(key) || value !== (key === 'name' ? name : '1.1')) fail();
      seen.add(key);
      inContext = false;
    } else if (line === 'context:') {
      if (seen.has('context')) fail();
      seen.add('context');
      inContext = true;
    } else {
      const fixture = line.match(/^  scaffold_script:[ ]*([A-Za-z0-9_./-]+)$/)?.[1];
      if (!fixture || !inContext || seen.has('scaffold_script')) fail();
      if (!inside(resolve(caseDir, fixture), caseDir)) throw Error(`${name}: fixture must be inside its case folder`);
      seen.add('scaffold_script');
    }
  }
  if (seen.has('context') && !seen.has('scaffold_script')) fail();
}

function deterministicCases(root, trial) {
  if (!Array.isArray(trial.cases) || trial.cases.length === 0) throw Error('trial needs cases');
  const seen = new Set();
  return trial.cases.map(c => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name) || seen.has(c.name)) throw Error('trial case names must be unique kebab-case names');
    seen.add(c.name);
    if (c.acceptanceThreshold !== undefined && c.acceptanceThreshold !== 1) throw Error('compare requires all deterministic graders to pass (acceptanceThreshold 1)');
    const caseDir = join(root, 'cases', c.name);
    validateComparisonCase(caseDir, c.name);
    const graders = readdirSync(join(caseDir, 'graders')).filter(n => n.endsWith('.md')).sort().map(name => {
      const src = readFileSync(join(caseDir, 'graders', name), 'utf8');
      const type = src.match(/^type:\s*(\S+)\s*$/m)?.[1];
      if (!['regex', 'file_exists', 'tool_used'].includes(type)) throw Error(`${c.name}/${name}: compare supports deterministic regex, file_exists and tool_used graders only`);
      return name.slice(0, -3);
    });
    if (!graders.length) throw Error(`${c.name}: no graders`);
    return { name: c.name, dimension: c.dimension, acceptanceThreshold: 1, graderNames: graders };
  });
}

export function inspectComparison(args, checkFolder) {
  const opts = parseComparisonArgs(args);
  const sources = [...opts.paths, opts.trial].map(p => {
    if (lstatSync(resolve(p)).isSymbolicLink()) throw Error('input folder cannot be a symlink');
    const real = realpathSync(p);
    if (!statSync(real).isDirectory()) throw Error(`not a folder: ${p}`);
    return real;
  });
  const requested = resolve(opts.out);
  // Parent must exist: canonicalize it to prevent aliases into either source tree.
  const output = join(realpathSync(dirname(requested)), requested.slice(dirname(requested).length + 1));
  if (sources.some(p => overlap(output, p))) throw Error('--out must be outside every input folder and cannot contain an input');
  if (existsSync(output)) throw Error('--out must be a new directory; nothing was overwritten');
  const files = sources.map((root, i) => inventory(root, i < 2, '', true));
  const trialInput = json(join(sources[2], 'trial.json'));
  deterministicCases(sources[2], trialInput);
  // No fixture or plugin code is executed in preflight.
  for (let i = 0; i < 3; i++) checkFolder(sources[i], i === 2 ? 'trial' : 'build', { structuralOnly: true, ignoreEvals: true });
  return { opts, sources, output, files };
}

export function describeInputs(inputs) {
  const trialRecord = json(join(inputs[2], 'trial.json'));
  const cases = deterministicCases(inputs[2], trialRecord);
  const trial = { slug: trialRecord.slug, version: trialRecord.version, sha256: treeHash(inputs[2]), cases };
  const builds = inputs.slice(0, 2).map(p => {
    const manifest = json(join(p, 'buildguild.json'));
    const plugin = json(join(p, '.claude-plugin/plugin.json'));
    return { slug: manifest.slug, version: manifest.version ?? plugin.version, plugin: { name: plugin.name, version: plugin.version }, sha256: treeHash(p) };
  });
  return { inputs, cases, trial, builds };
}

export function stageInputs({ sources, output, files }, checkFolder) {
  const inputs = inputLabels.map(label => join(output, 'inputs', label));
  sources.forEach((source, i) => snapshot(source, inputs[i], files[i]));
  for (let i = 0; i < 3; i++) checkFolder(inputs[i], i === 2 ? 'trial' : 'build', { structuralOnly: true, ignoreEvals: true });
  return describeInputs(inputs);
}
