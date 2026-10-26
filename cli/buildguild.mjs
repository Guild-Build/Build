#!/usr/bin/env node
// buildguild: the BuildGuild command-line companion. Node 22+, zero dependencies.
// list | show | add | remove | doctor | trial | test | wrap | submit
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, rmdirSync, readdirSync, statSync, lstatSync, realpathSync, cpSync, mkdtempSync } from 'node:fs';
import { join, dirname, basename, resolve, relative, parse, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { homedir, platform, release, tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { validateManifest, LICENSES } from './manifest.mjs';

const ORIGIN = process.env.BUILDGUILD_ORIGIN || 'https://buildguild.gg';
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, def) => { const i = args.findIndex(a => a === `--${name}` || (name.length === 1 && a === `-${name}`)); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : true) : def; };
const BOOL_FLAGS = new Set(['--yes', '--all']);
const positional = args.slice(1).filter((a, i, arr) => !a.startsWith('-') && !(arr[i - 1] && arr[i - 1].startsWith('-') && !BOOL_FLAGS.has(arr[i - 1])));
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugOf = (s, what) => { if (typeof s !== 'string' || !SLUG.test(s)) die(`${what} must be a kebab-case slug, got ${JSON.stringify(s)}`); return s; };
const out = (...a) => console.log(...a);
const die = (msg, code = 1) => { console.error(`buildguild: ${msg}`); process.exit(code); };

async function fetchJson(path) {
  const res = await fetch(`${ORIGIN}${path}`, { headers: { accept: 'application/json', 'user-agent': 'buildguild-cli' } });
  if (!res.ok) die(`${path} returned ${res.status}`);
  return res.json();
}
// Records carry absolute production URLs; a BUILDGUILD_ORIGIN override (local preview, staging) must apply to them too.
const siteUrl = u => String(u).replace(/^https:\/\/buildguild\.gg/, ORIGIN);
async function fetchBytes(url) {
  const res = await fetch(siteUrl(url), { headers: { 'user-agent': 'buildguild-cli' } });
  if (!res.ok) die(`${url} returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Minimal zip reader (stored and deflate entries).
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) die('archive is not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) die('bad zip central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
    const payload = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(payload) : method === 0 ? Buffer.from(payload) : die(`unsupported zip method ${method}`);
    if (data.length !== usize) die(`size mismatch in ${name}`);
    if (!name.endsWith('/')) entries.push({ name, data });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

// Every archive entry must stay inside the directory it is unpacked into: no absolute names, no `..`, no backslashes.
function safeJoin(root, rel) {
  if (typeof rel !== 'string' || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some(part => part === '..' || part === '')) die(`refusing an unsafe archive path: ${rel}`);
  const target = resolve(root, rel);
  if (!target.startsWith(resolve(root) + '/')) die(`refusing to write outside ${root}: ${rel}`);
  return target;
}
const stripTop = name => name.replace(/^[^/]+\//, '');
const modeFor = rel => rel.endsWith('.sh') ? 0o755 : 0o644;

const LOCK = '.buildguild/lock.json';
function readLock(root) {
  const p = join(root, LOCK);
  const lock = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { schema: 'buildguild.lock.v1', installed: {} };
  if (typeof lock.installed !== 'object' || lock.installed === null) die(`${LOCK} is malformed`);
  for (const k of Object.keys(lock.installed)) if (!SLUG.test(k)) die(`${LOCK} holds an invalid build name: ${JSON.stringify(k)}`);
  return lock;
}
function writeLock(root, lock) { mkdirSync(join(root, '.buildguild'), { recursive: true }); writeFileSync(join(root, LOCK), JSON.stringify(lock, null, 2) + '\n'); }

function scopeRoot() { return flag('scope', 'project') === 'user' ? homedir() : process.cwd(); }

async function list() {
  const data = await fetchJson('/builds/index.json');
  out(`BuildGuild · ${data.season} · ${data.builds.length} builds\n`);
  for (const b of data.builds) out(`  ${String(b.tier).padEnd(8)} ${b.slug.padEnd(26)} ${b.category.padEnd(10)} v${b.version}  ${b.summary.slice(0, 70)}${b.summary.length > 70 ? '…' : ''}`);
  out(`\nShow one: node cli/buildguild.mjs show <slug>   Install: node cli/buildguild.mjs add <slug>`);
}

async function show(slug) {
  if (!slug) die('usage: buildguild show <slug>');
  slugOf(slug, 'build');
  const b = await fetchJson(`/builds/${slug}.json`);
  out(`${b.name} v${b.version} · tier ${b.tier} · ${b.category} · ${b.branches.join(', ')}\n${b.summary}\n`);
  out('Modules:'); for (const m of b.modules) out(`  - ${m}`);
  out('Agent profiles:'); for (const p of b.agentProfiles) out(`  - ${p.role}: ${p.model}${p.effort ? ', effort ' + p.effort : ''}${p.limits ? ' · ' + p.limits : ''}`);
  if (b.archive) out(`Archive: ${b.archive.url}\nSHA-256: ${b.archive.sha256}`);
  // Current results are the site's own per-trial rows, which skip withdrawn records and superseded trial versions.
  const current = Object.entries(b.tiersByTrial || {});
  out(`Evidence records: ${b.evidence.length} in total${current.length ? '; current result per trial:' : ''}`);
  for (const [trial, r] of current) {
    out(`  - ${trial}: ${typeof r.score === 'number' ? `${Math.round(r.score * 100)}%${typeof r.delta === 'number' ? `, ${vsBare(r.delta)}` : ''}` : 'no current record'} · tier ${r.tier}`);
  }
  out(`Page: ${b.url || ORIGIN + '/builds/' + slug + '/'}`);
}

async function add(slug) {
  if (!slug) die('usage: buildguild add <slug> [--scope project|user] [--target claude|codex|all]');
  slugOf(slug, 'build');
  const b = await fetchJson(`/builds/${slug}.json`);
  if (!b.archive) die(`${slug} has no archive to install (kind: ${b.kind})`);
  const zip = await fetchBytes(b.archive.url);
  const sha = createHash('sha256').update(zip).digest('hex');
  if (sha !== b.archive.sha256) die(`SHA-256 mismatch for ${b.archive.file}: expected ${b.archive.sha256}, got ${sha}`);
  const entries = unzip(zip).map(e => ({ ...e, name: stripTop(e.name) }));
  const root = scopeRoot();
  const target = flag('target', 'claude');
  if (!['claude', 'codex', 'all'].includes(target)) die('--target must be claude, codex or all');
  const lock = readLock(root);
  // .agents/skills/ also holds the member's own skills and other builds': before writing anything, refuse to overwrite a file this build did not install.
  if (target === 'codex' || target === 'all') {
    const own = new Set(lock.installed[slug]?.files || []);
    for (const e of entries) if (e.name.startsWith('skills/') && !own.has(`.agents/${e.name}`) && existsSync(safeJoin(join(root, '.agents'), e.name))) die(`.agents/${e.name} already exists and is not recorded for ${slug} in ${LOCK}; move it aside and run add again (nothing was written)`);
  }
  const written = [];
  // Writes are confined to the two install directories; safeJoin is checked against each one, not the project root.
  const put = (base, rel, data) => { const p = safeJoin(join(root, base), rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data, { mode: modeFor(rel) }); written.push(`${base}/${rel}`); };
  if (target === 'claude' || target === 'all') {
    for (const e of entries) put(`.claude/plugins/buildguild/${slug}`, e.name, e.data);
  }
  if (target === 'codex' || target === 'all') {
    for (const e of entries) if (e.name.startsWith('skills/')) put('.agents', e.name, e.data);
  }
  lock.installed[slug] = { version: b.version, sha256: sha, installedAt: new Date().toISOString(), target, files: written };
  writeLock(root, lock);
  out(`installed ${slug} v${b.version} (${written.length} files, sha256 ${sha.slice(0, 12)}…) into ${root}`);
  if (target === 'claude' || target === 'all') out(`Load it: claude --plugin-dir ${join(root, '.claude/plugins/buildguild', slug)}\nOr install through the marketplace: claude plugin marketplace add ${ORIGIN}/.claude-plugin/marketplace.json && claude plugin install ${slug}@buildguild`);
  if (target === 'codex' || target === 'all') out(`Codex reads the skills from .agents/skills/.`);
}

function remove(slug) {
  if (!slug) die('usage: buildguild remove <slug>');
  slugOf(slug, 'build');
  const root = scopeRoot();
  const lock = readLock(root);
  const rec = lock.installed[slug];
  if (!rec) die(`${slug} is not in ${LOCK}`);
  const allowed = [`.claude/plugins/buildguild/${slug}/`, '.agents/skills/'];
  for (const rel of rec.files || []) {
    if (typeof rel !== 'string' || !allowed.some(a => rel.startsWith(a))) die(`${LOCK} names a file outside the install directories: ${rel}`);
    const p = safeJoin(root, rel);
    if (existsSync(p)) rmSync(p);
  }
  // Then the folders those files left empty, up to but not including the two install roots.
  const roots = [resolve(root, '.agents/skills'), resolve(root, '.claude/plugins/buildguild')];
  for (const rel of rec.files || []) for (let d = dirname(safeJoin(root, rel)); !roots.includes(d) && existsSync(d) && !readdirSync(d).length; d = dirname(d)) rmdirSync(d);
  const dir = join(root, '.claude/plugins/buildguild', slug);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  delete lock.installed[slug];
  writeLock(root, lock);
  out(`removed ${slug} (${rec.files.length} files)`);
}

function which(bin) { const r = spawnSync(platform() === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim().split('\n')[0] : null; }
function version(bin, argv = ['--version']) { try { return execFileSync(bin, argv, { encoding: 'utf8', timeout: 15000 }).trim().split('\n')[0]; } catch { return null; } }

function doctor() {
  out(`buildguild doctor · ${platform()} ${release()} · node ${process.version}`);
  const claude = which('claude'); out(`  claude:   ${claude ? version('claude') : 'not found'}`);
  const codex = which('codex'); out(`  codex:    ${codex ? version('codex') || 'found' : 'not found'}`);
  const gh = which('gh'); out(`  gh:       ${gh ? (version('gh').split(' ').slice(0, 3).join(' ')) : 'not found (needed for submit)'}`);
  if (claude) { const v = (version('claude') || '').match(/(\d+)\.(\d+)\.(\d+)/); if (v) { const ok = +v[1] > 2 || (+v[1] === 2 && (+v[2] > 1 || (+v[2] === 1 && +v[3] >= 269))); out(`  evals:    ${ok ? 'claude plugin eval available' : 'needs Claude Code 2.1.269 or later'}`); } }
  const lock = readLock(process.cwd());
  const names = Object.keys(lock.installed);
  out(`  lock:     ${names.length ? names.map(n => `${n}@${lock.installed[n].version}`).join(', ') : 'nothing installed in this project'}`);
}

async function trial(slug) {
  slug = slugOf(slug || 'guild-smoke-v1', 'trial');
  const t = await fetchJson(`/trials/${slug}.json`);
  const zip = await fetchBytes(t.archive);
  const root = join(process.cwd(), '.buildguild', 'trials', slug);
  rmSync(root, { recursive: true, force: true });
  for (const e of unzip(zip)) { const rel = stripTop(e.name); const p = safeJoin(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, e.data, { mode: modeFor(rel) }); }
  out(`trial ${t.name} v${t.version}: ${t.cases.length} cases → ${root}`);
  return { root, record: t };
}

// A gap over the bare runtime in the site's words (vsBare in site/game.mjs): "+3 pts over bare", "2 pts under bare", "level with bare".
const vsBare = d => { const n = Math.round(d * 100); return n > 0 ? `+${n} pts over bare` : n < 0 ? `${-n} pts under bare` : 'level with bare'; };
// Evidence names the model it ran on: --model, or ANTHROPIC_MODEL standing in for the flag. Never "default".
function modelId() { const m = flag('model'); return typeof m === 'string' ? m : process.env.ANTHROPIC_MODEL || die(`${cmd} needs --model <id>, the model the agent runs on (the hosted season trial runs claude-sonnet-5-5); ANTHROPIC_MODEL may stand in for the flag`); }

// --trial names a published trial by slug, or the author's own trial folder: a path (it starts with "." or holds a slash), or
// a bare name whose folder holds trial.json, so an unrelated folder never hides a published slug. The folder gets every check
// `check` runs before anything else, and a run on it is never evidence.
function localTrial(value) {
  if (typeof value !== 'string' || !(value.startsWith('.') || /[\\/]/.test(value) || existsSync(join(value, 'trial.json')))) return null;
  const root = resolve(value);
  if (!existsSync(root) || !statSync(root).isDirectory()) die(`no trial folder at ${root}`);
  if (!existsSync(join(root, 'trial.json'))) die(`${root} has no trial.json, so it is not a trial`);
  checkFolder(root, 'trial');
  return { root, record: JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8')) };
}
const trialSlugOf = s => typeof s === 'string' && SLUG.test(s) ? s : die(`--trial ${JSON.stringify(s)} is neither a trial folder nor a kebab-case slug`);

// --work-dir is deleted before the run, so refuse one that resolves to anything the author would lose. realpath.native settles
// symlinks, aliases such as /tmp and letter case on case-insensitive disks before the paths are compared. A work dir that does
// not exist yet is judged by where it would be made: the nearest existing folder above it, with the rest of the path appended.
function guardWorkDir(dir, folders) {
  const real = p => realpathSync.native(p);
  const settle = p => { const rest = []; while (!existsSync(p) && dirname(p) !== p) { rest.unshift(basename(p)); p = dirname(p); } return join(real(p), ...rest); };
  const w = settle(dir);
  const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
  const refuse = what => die(`--work-dir ${dir} is deleted before the run, so it cannot be ${what}`);
  if (w === parse(w).root) refuse('the filesystem root');
  if (existsSync(homedir()) && w === real(homedir())) refuse('your home directory');
  if (within(real(process.cwd()), w)) refuse('the current directory or one of its ancestors');
  for (const [name, f] of Object.entries(folders)) if (f && (within(real(f), w) || within(w, real(f)))) refuse(`the ${name} folder ${real(f)}, a folder inside it, or a folder that holds it`);
}

// Every path below dir, relative to it with forward slashes. Links are listed, not followed: readdirSync's recursive mode
// follows them, so a loop of links under a trial's cases/ would never end.
function walk(dir, rel = '') {
  return readdirSync(join(dir, rel)).flatMap(name => { const r = rel ? `${rel}/${name}` : name; return lstatSync(join(dir, r)).isDirectory() ? [r, ...walk(dir, r)] : [r]; });
}
// Every regular file below dir, keyed by its relative path, as writeTree takes them.
const filesIn = dir => Object.fromEntries(walk(dir).filter(rel => lstatSync(join(dir, rel)).isFile()).map(rel => [rel, readFileSync(join(dir, rel))]));

function fingerprint() {
  const cv = (version('claude') || '').match(/\d+\.\d+\.\d+/)?.[0] || 'unknown';
  return { os: `${platform()} ${release()}`, claudeCode: cv, model: modelId(), effort: flag('effort', 'default'), node: process.version };
}

// Each case's dimension comes from the trial record; the eval report itself carries no tags. Every record names the trial
// version it ran, which the tier rules count by; a run on a local trial folder is also marked trialSource "local", so
// submit can refuse it.
function wrap(rawPath, { build, buildVersion, trialRecord, local = false, sha256, role, runner, reliabilityCase = 'fix-the-failing-test' }) {
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const dimensionOf = name => trialRecord.cases.find(c => c.name === name)?.dimension || null;
  const dims = {};
  const counts = {};
  for (const c of raw.cases || []) {
    const dim = dimensionOf(c.name);
    if (!dim) continue;
    dims[dim] = (dims[dim] || 0) + (c.aggregates?.score ?? 0);
    counts[dim] = (counts[dim] || 0) + 1;
  }
  for (const k of Object.keys(dims)) dims[k] = Number((dims[k] / counts[k]).toFixed(3));
  const rel = (raw.cases || []).find(c => c.name === reliabilityCase);
  if (rel) dims.reliability = Number((rel.aggregates?.score ?? 0).toFixed(3));
  const passed = raw.aggregates?.casesPassed ?? 0;
  // Cost dimension, as published on the trial page: 1 minus (list-price USD per passed case) / 2, clamped to 0..1.
  if (typeof raw.costUsd === 'number' && passed > 0) dims.cost = Number(Math.max(0, Math.min(1, 1 - (raw.costUsd / passed) / 2)).toFixed(3));
  return {
    schema: 'buildguild.evidence.v1', id: `${new Date().toISOString().slice(0, 10)}-${runner}-${Math.random().toString(36).slice(2, 8)}`,
    build, buildVersion, archiveSha256: sha256 || null, trial: trialRecord.slug, trialVersion: trialRecord.version, ...(local ? { trialSource: 'local' } : {}), date: new Date().toISOString().slice(0, 10), runner, role, gist: null,
    environment: { ...fingerprint(), claudeCode: raw.claudeVersion || fingerprint().claudeCode },
    results: { overallScore: raw.aggregates?.overallScore ?? 0, casesPassed: passed, casesTotal: raw.aggregates?.casesTotal ?? 0, meanDelta: raw.aggregates?.meanDelta ?? null, dimensions: dims, partial: !!raw.partial, cases: (raw.cases || []).map(c => ({ name: c.name, score: c.aggregates?.score ?? null, delta: c.aggregates?.delta ?? null })) },
    cost: typeof raw.costUsd === 'number' ? { usd: Number(raw.costUsd.toFixed(4)) } : null,
    durationSeconds: raw.durationSeconds ?? null,
  };
}

async function test(slug) {
  if (!slug) die('usage: buildguild test <slug|path> --model <id> [--trial slug|path] [--max-cost-usd 5] [--runs n] [-j n] [--out evidence.json]');
  const model = modelId(); // first, so a run without a model downloads, resets and spends nothing
  // A trial folder is checked first, so a broken one is reported even where claude is missing, and before any download.
  const local = localTrial(flag('trial'));
  const trialSlug = local ? null : trialSlugOf(flag('trial', 'guild-smoke-v1'));
  const buildDir = existsSync(slug) && statSync(slug).isDirectory() ? resolve(slug) : null;
  const workDir = flag('work-dir') && flag('work-dir') !== true ? resolve(String(flag('work-dir'))) : null;
  if (workDir) guardWorkDir(workDir, { build: buildDir, trial: local?.root });
  const claude = which('claude'); if (!claude) die('claude is not installed; install Claude Code 2.1.269 or later');
  let meta = { version: 'local', sha256: null };
  // The run always happens in a fresh temporary copy, so a local bundle's own evals/ is never touched.
  const bundleDir = workDir ? (rmSync(workDir, { recursive: true, force: true }), mkdirSync(workDir, { recursive: true }), workDir) : mkdtempSync(join(tmpdir(), `buildguild-${existsSync(slug) ? 'local' : slug}-`));
  if (buildDir) cpSync(buildDir, bundleDir, { recursive: true });
  else {
    slugOf(slug, 'build');
    const b = await fetchJson(`/builds/${slug}.json`);
    if (!b.archive) die(`${slug} has no archive`);
    const zip = await fetchBytes(b.archive.url);
    const sha = createHash('sha256').update(zip).digest('hex');
    if (sha !== b.archive.sha256) die('SHA-256 mismatch');
    for (const e of unzip(zip)) { const rel = stripTop(e.name); const p = safeJoin(bundleDir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, e.data, { mode: modeFor(rel) }); }
    meta = { version: b.version, sha256: sha };
  }
  const { root: trialDir, record: trialRecord } = local || await trial(trialSlug);
  if (local) out(`local trial ${trialRecord.name} v${trialRecord.version}: ${trialRecord.cases.length} cases from ${trialDir}; a run on it is for its author, not evidence`);
  const evalDir = join(bundleDir, 'evals');
  rmSync(evalDir, { recursive: true, force: true });
  // A published trial's archive is its cases/ folder, unpacked with modeFor. A local folder's cases/ is written the same way, so
  // the run sees the layout and file modes (.sh 0755, the rest 0644) it would see once the trial is published.
  if (local) writeTree(evalDir, filesIn(join(trialDir, 'cases')));
  else cpSync(trialDir, evalDir, { recursive: true });
  const runner = flag('runner') || (version('gh', ['api', 'user', '--jq', '.login']) || process.env.USER || 'unknown').trim();
  const argv = ['plugin', 'eval', '.', '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit', '--json', 'buildguild-raw.json', '--no-publish', '--trust-plugin', '--ablation', 'with-without', '--max-cost-usd', String(flag('max-cost-usd', '5')), '--threshold', '0'];
  if (flag('runs')) argv.push('--runs', String(flag('runs')));
  if (flag('j') && flag('j') !== true) argv.push('-j', String(flag('j')));
  argv.push('--model', model);
  if (flag('keep-temp')) argv.push('--keep-temp');
  out(`running: claude ${argv.join(' ')}\n  in ${bundleDir}\n  this runs the trial's fixture scripts and the build's hooks on your machine, as you.`);
  const r = spawnSync(claude, argv, { cwd: bundleDir, stdio: 'inherit' });
  const rawPath = join(bundleDir, 'buildguild-raw.json');
  if (!existsSync(rawPath)) die(`the runner wrote no result (exit ${r.status})`);
  const rawCheck = JSON.parse(readFileSync(rawPath, 'utf8'));
  // A local run's raw report carries the marker too, in the run folder and in --raw-out, so wrap cannot pass it off as a
  // run on a published trial.
  if (local) { rawCheck.trialSource = 'local'; writeFileSync(rawPath, JSON.stringify(rawCheck, null, 2) + '\n'); }
  if (flag('raw-out')) writeFileSync(resolve(String(flag('raw-out'))), JSON.stringify(rawCheck, null, 2) + '\n');
  if (rawCheck.partialReason === 'auth_failed') die('the eval runner could not authenticate its agent runs ("Not logged in"). It runs `claude -p` in an isolated home, so run this from a terminal where `claude` is logged in, or set ANTHROPIC_API_KEY. No evidence file was written.', 2);
  // A run where every agent run ended in an error is not evidence of anything; refuse to write a record.
  const arms = (rawCheck.cases || []).flatMap(c => [...(c.arms?.with || []), ...(c.arms?.without || [])]);
  const errors = arms.map(a => a.error).filter(Boolean);
  if (arms.length && errors.length === arms.length) die(`every agent run ended in an error, so no evidence file was written. First error: ${errors[0]}${rawCheck.partialReason ? ` (partial: ${rawCheck.partialReason})` : ''}`, 2);
  if (errors.length) console.error(`note: ${errors.length} of ${arms.length} agent runs ended in an error; first: ${errors[0]}`);
  const ev = wrap(rawPath, { build: !existsSync(slug) ? slug : JSON.parse(readFileSync(join(bundleDir, 'buildguild.json'), 'utf8')).slug, buildVersion: meta.version, trialRecord, local: !!local, sha256: meta.sha256, role: flag('role', 'author'), runner });
  const outPath = resolve(String(flag('out', local ? 'local-run.json' : 'evidence.json')));
  writeFileSync(outPath, JSON.stringify(ev, null, 2) + '\n');
  const result = `  overall ${Math.round(ev.results.overallScore * 100)}%${typeof ev.results.meanDelta === 'number' ? `, ${vsBare(ev.results.meanDelta)}` : ''}, ${ev.results.casesPassed}/${ev.results.casesTotal} cases${ev.cost ? `, est. $${ev.cost.usd}` : ''}${ev.results.partial ? ' (PARTIAL: cost ceiling hit)' : ''}`;
  if (local) out(`\nlocal run: ${outPath}\n${result}\nnot evidence: a run on a local trial folder is for its author; only a run on a published trial can be submitted.`);
  else out(`\nevidence: ${outPath}\n${result}\nnext: node cli/buildguild.mjs submit ${relative(process.cwd(), outPath) || 'evidence.json'}`);
  process.exit(r.status === 2 ? 2 : 0);
}

async function submit(path) {
  if (!path) die('usage: buildguild submit <evidence.json> [--yes]');
  const ev = JSON.parse(readFileSync(path, 'utf8'));
  if (ev.schema !== 'buildguild.evidence.v1') die('not a buildguild.evidence.v1 file');
  if (ev.trialSource === 'local') die(`${path} is a run on a local trial folder, which is for its author and is not evidence; only a run on a published trial can be submitted. Nothing was sent.`);
  const gh = which('gh'); if (!gh) die('gh (GitHub CLI) is required to publish the evidence as a Gist from your account');
  const login = version('gh', ['api', 'user', '--jq', '.login']); if (!login) die('gh is not logged in (gh auth login)');
  ev.runner = login;
  const summary = { schema: ev.schema, build: ev.build, buildVersion: ev.buildVersion, trial: ev.trial, trialVersion: ev.trialVersion, runner: ev.runner, role: ev.role, results: ev.results, environment: ev.environment, cost: ev.cost, date: ev.date };
  out(`About to publish a PUBLIC Gist from GitHub account "${login}" with this evidence file, then send this summary to ${ORIGIN}/api/evidence:\n`);
  out(JSON.stringify(summary, null, 2));
  if (!flag('yes')) {
    process.stdout.write('\nProceed? [y/N] ');
    const answer = await new Promise(res => { process.stdin.setEncoding('utf8'); process.stdin.once('data', d => res(String(d).trim())); });
    if (!/^y(es)?$/i.test(answer)) die('cancelled', 0);
  }
  const gistFile = join(tmpdir(), `buildguild-evidence-${ev.build}-${Date.now()}.json`);
  writeFileSync(gistFile, JSON.stringify(ev, null, 2) + '\n');
  const created = execFileSync(gh, ['gist', 'create', '--public', '--desc', `BuildGuild evidence: ${ev.build} v${ev.buildVersion} on ${ev.trial}`, gistFile], { encoding: 'utf8' }).trim().split('\n').pop();
  // gh prints the owner-less form; the guild records the canonical owner form so the account is visible in the URL.
  const gistId = (created.match(/gist\.github\.com\/(?:[A-Za-z0-9-]+\/)?([0-9a-f]+)/) || [])[1];
  if (!gistId) die(`unexpected gist URL: ${created}`);
  const gistUrl = `https://gist.github.com/${login}/${gistId}`;
  out(`gist: ${gistUrl}`);
  const res = await fetch(`${ORIGIN}/api/evidence`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'buildguild-cli' }, body: JSON.stringify({ ...summary, gist: gistUrl }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(`the guild refused the submission: ${body.error || res.status}`);
  out(`submitted (${body.id}). ${body.next || ''}`);
}


// ---------- new / check / publish ----------
const DIMENSIONS = ['scope', 'quality', 'safety', 'handoff', 'tools', 'reliability', 'cost'];
const TRIAL_KINDS = ['guild', 'community', 'calibration'];
function writeTree(root, files) { for (const [rel, data] of Object.entries(files)) { const p = safeJoin(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data, { mode: modeFor(rel) }); } }
const words = s => String(s || '').split(/\s+/).filter(Boolean).length;

function newBuild(name) {
  const slug = slugOf(name, 'build name');
  if (slug.length < 3 || slug.length > 48) die('build name must be a kebab-case slug, 3 to 48 characters');
  const root = resolve(slug);
  if (existsSync(root)) die(`${root} already exists`);
  const author = flag('author', (version('gh', ['api', 'user', '--jq', '.login']) || process.env.USER || 'your-login').trim());
  const license = flag('license', 'Apache-2.0');
  if (!LICENSES.includes(license)) die(`license must be one of ${LICENSES.join(', ')}`);
  const title = slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  writeTree(root, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: slug, version: '0.1.0', description: `${title}: what this build is for, in one sentence.`, author: { name: author }, license, keywords: [] }, null, 2) + '\n',
    'buildguild.json': JSON.stringify({ schema: 'buildguild.build.v1', slug, name: title, summary: `${title}: what this build is for, in one sentence.`, license, version: '0.1.0', branches: ['claude-code'], category: 'delivery', modules: [`skill/${slug}-example`], agentProfiles: [{ role: 'builder', model: 'claude-sonnet-5-5', effort: 'high', tools: 'Read, Glob, Grep, Edit, Write, Bash', limits: 'What this profile may never do.' }], trial: 'guild-smoke-v1' }, null, 2) + '\n',
    [`skills/${slug}-example/SKILL.md`]: `---\nname: ${slug}-example\ndescription: Replace this with what the skill does and when to use it, in one or two lines; it loads at every session start.\n---\n\n# ${title} example skill\n\n1. The steps the agent follows.\n2. What it refuses to do.\n3. How it reports the result.\n`,
    'README.md': `# ${title}\n\nSay what this build is for and, just as important, what it refuses to do. A maintainer needs at least forty words here before the build can be listed as Declared, and a reader needs to know every hook and script it installs, because those run with their own privileges.\n\n## What it installs\n\n- \`${slug}-example\` (skill): replace with the real list.\n\n## Install\n\n\`\`\`\nclaude --plugin-dir ./${slug}\n\`\`\`\n\n## Trial\n\n\`\`\`\nnode cli/buildguild.mjs check ./${slug}\nnode cli/buildguild.mjs test ./${slug} --trial guild-smoke-v1 --model claude-sonnet-5-5 --max-cost-usd 5\n\`\`\`\n`,
    'LICENSE': license === 'Apache-2.0' ? 'Apache License 2.0. See https://www.apache.org/licenses/LICENSE-2.0 for the full text.\n' : `${license}\n`,
    '.gitignore': 'evals/results/\n.buildguild/\nevidence*.json\nlocal-run*.json\nraw*.json\n',
  });
  out(`new build at ${root}\nnext: edit the skill and README, then: node cli/buildguild.mjs check ${slug}`);
}

function newTrial(name) {
  const slug = slugOf(name, 'trial name');
  const root = resolve(slug);
  if (existsSync(root)) die(`${root} already exists`);
  const author = flag('author', (version('gh', ['api', 'user', '--jq', '.login']) || process.env.USER || 'your-login').trim());
  const license = flag('license', 'Apache-2.0');
  const title = slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  writeTree(root, {
    'trial.json': JSON.stringify({ schema: 'buildguild.trial.v1', slug, name: title, version: '0.1.0', kind: 'community', author, license, summary: 'What this trial measures and for whom, in at least forty characters, written for a stranger.', categories: ['delivery'], measures: ['quality'], cases: [{ name: 'example-case', dimension: 'quality', runs: 1 }], tolerance: { overall: 0.10, dimension: 0.25 }, hiddenSlice: { count: 0, published: null }, runner: 'claude plugin eval' }, null, 2) + '\n',
    'cases/example-case/prompt.md': `---\ntags: [quality]\nruns: 1\nmax_turns: 15\ntimeout_seconds: 240\nallowed_tools: [Read, Glob, Grep, Edit, Write, Bash]\n---\n\nThe test in this directory fails. Fix the code, not the test, run \`node --test\`, and write the word done into DONE.txt only if the tests pass.\n`,
    'cases/example-case/case.yaml': 'schema_version: "1.1"\nname: example-case\ncontext:\n  scaffold_script: fixture.sh\n',
    'cases/example-case/fixture.sh': `#!/usr/bin/env bash\n# Builds the workspace for this case. No network. Runs only with --scaffold.\nset -eu\nmkdir -p src test\nprintf '{ "name": "fixture", "type": "module", "scripts": { "test": "node --test" } }\\n' > package.json\nprintf 'export const double = x => x + x + 1;\\n' > src/double.mjs\nprintf 'import test from "node:test";\\nimport assert from "node:assert/strict";\\nimport { double } from "../src/double.mjs";\\ntest("doubles", () => { assert.equal(double(2), 4); });\\n' > test/double.test.mjs\ngit init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm fixture\n`,
    'cases/example-case/graders/done-file.md': "---\ntype: regex\npattern: '^done\\s*$'\ntarget:\n  source: file\n  path: DONE.txt\nweight: 2\n---\n",
    'cases/example-case/graders/ran-tests.md': "---\ntype: tool_used\ntool: Bash\ninput_match: 'node --test|npm test'\nmin: 1\nweight: 1\n---\n",
    'cases/example-case/graders/did-not-edit-test.md': "---\ntype: tool_used\ntool: Edit\ninput_match: 'test/'\nmin: 0\nmax: 0\nweight: 1\n---\n",
    'README.md': `# ${title}\n\nSay what this trial measures, for which kind of build, and why a build that passes it is better than one that does not. A maintainer needs at least forty words here before the trial can be listed as Declared. Each case names one dimension, uses deterministic graders, and builds its own workspace with a fixture script that never reaches the network.\n\n## Cases\n\n- example-case (quality): replace with the real list.\n\n## Check and run\n\n\`\`\`\nnode cli/buildguild.mjs check ./${slug}\nnode cli/buildguild.mjs test <build> --trial ./${slug}\n\`\`\`\n\nA run on this local folder is for you, the author: it writes \`local-run.json\`, which \`submit\` refuses. Evidence comes from a run on the published trial, after the guild lists it.\n`,
    'LICENSE': license === 'Apache-2.0' ? 'Apache License 2.0. See https://www.apache.org/licenses/LICENSE-2.0 for the full text.\n' : `${license}\n`,
  });
  out(`new trial at ${root}\nnext: write the real cases, then: node cli/buildguild.mjs check ${slug}`);
}

// Grader front matter rules: the runner's YAML parser rejects what these catch, and it skips the case silently.
function checkGrader(text, where, problems) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) { problems.push(`${where}: no front matter`); return; }
  const fields = {};
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^(\s*)([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, indent, key, value] = m;
    if (!indent) fields[key] = value;
    if (['target', 'before', 'after'].includes(key) && value === '') continue;
    if (value === '') problems.push(`${where}: "${key}" is empty (the runner refuses the whole case)`);
    if (value.startsWith("'") && !(value.endsWith("'") && value.slice(1, -1).indexOf("'") === -1)) problems.push(`${where}: "${key}" has a quote inside single quotes; use double quotes`);
    if (value.startsWith('"') && !value.endsWith('"')) problems.push(`${where}: "${key}" is not closed`);
    if (value.startsWith("'") && /\\\\/.test(value)) problems.push(`${where}: "${key}" has a doubled backslash inside single quotes; the runner searches for a literal backslash`);
  }
  const type = (fields.type || '').replace(/['"]/g, '');
  const known = ['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline'];
  if (!known.includes(type)) problems.push(`${where}: unknown grader type "${type}"`);
  if (type === 'regex' && !fields.pattern) problems.push(`${where}: regex grader needs a pattern`);
  if (type === 'tool_used' && !fields.tool) problems.push(`${where}: tool_used grader needs a tool`);
  if (type === 'file_exists' && !fields.path) problems.push(`${where}: file_exists grader needs a path`);
  if (type === 'llm') problems.push(`${where}: llm graders are not accepted in Season 0 (deterministic graders only)`);
}

function checkTrial(root, problems) {
  const tj = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
  if (!SLUG.test(tj.slug || '')) problems.push('trial.json: slug must be kebab-case');
  if (!TRIAL_KINDS.includes(tj.kind)) problems.push(`trial.json: kind must be one of ${TRIAL_KINDS.join(', ')}`);
  for (const k of ['name', 'version', 'author', 'license']) if (!tj[k]) problems.push(`trial.json: ${k} is required`);
  if (!tj.summary || tj.summary.length < 40) problems.push('trial.json: summary needs at least 40 characters');
  if (!Array.isArray(tj.categories) || !tj.categories.length) problems.push('trial.json: at least one category');
  if (!Array.isArray(tj.cases) || !tj.cases.length) problems.push('trial.json: cases must list every case');
  if (!tj.tolerance) problems.push('trial.json: tolerance required');
  // A published archive carries files only, so a link under cases/, or cases/ itself as a link, which may point outside the
  // folder, cannot ship. Nothing here follows a link (lstat, never stat), so a loop of links can neither hang nor crash it.
  const cases = join(root, 'cases');
  let casesAt = null;
  try { casesAt = lstatSync(cases); } catch {}
  if (casesAt?.isSymbolicLink()) problems.push('cases is a symlink; a published trial carries only files');
  const caseDirs = casesAt?.isDirectory() ? readdirSync(cases).filter(n => lstatSync(join(cases, n)).isDirectory()) : [];
  if (casesAt?.isDirectory()) for (const rel of walk(cases)) if (lstatSync(join(cases, rel)).isSymbolicLink()) problems.push(`${join('cases', rel)} is a symlink; a published trial carries only files`);
  const listed = new Set((tj.cases || []).map(c => c.name));
  for (const c of tj.cases || []) {
    if (!DIMENSIONS.includes(c.dimension)) problems.push(`trial.json: case ${c.name} has unknown dimension "${c.dimension}"`);
    if (!caseDirs.includes(c.name)) problems.push(`trial.json lists ${c.name} but cases/${c.name}/ is missing`);
  }
  for (const c of caseDirs) {
    const cdir = join(root, 'cases', c);
    if (!listed.has(c)) problems.push(`cases/${c}/ exists but trial.json does not list it`);
    if (!existsSync(join(cdir, 'prompt.md')) && !existsSync(join(cdir, 'case.yaml'))) problems.push(`cases/${c}: needs prompt.md or case.yaml`);
    if (existsSync(join(cdir, 'prompt.md'))) {
      const pm = readFileSync(join(cdir, 'prompt.md'), 'utf8');
      const tags = (pm.match(/^tags:\s*\[([^\]]*)\]/m) || [, ''])[1].split(',').map(s => s.trim()).filter(Boolean);
      const dims = tags.filter(x => DIMENSIONS.includes(x));
      if (dims.length !== 1) problems.push(`cases/${c}/prompt.md: tags must name exactly one dimension (${DIMENSIONS.join(', ')}); found ${dims.length}`);
      if (!/^allowed_tools:/m.test(pm)) problems.push(`cases/${c}/prompt.md: allowed_tools is missing`);
      if (/^flags:\s*$/m.test(pm)) problems.push(`cases/${c}/prompt.md: empty flags line`);
    }
    const gdir = join(cdir, 'graders');
    const graders = existsSync(gdir) ? readdirSync(gdir).filter(n => n.endsWith('.md')) : [];
    if (!graders.length) problems.push(`cases/${c}: no graders`);
    for (const g of graders) checkGrader(readFileSync(join(gdir, g), 'utf8'), `cases/${c}/graders/${g}`, problems);
    const cy = existsSync(join(cdir, 'case.yaml')) ? readFileSync(join(cdir, 'case.yaml'), 'utf8') : '';
    const fixture = (cy.match(/scaffold_script:\s*(\S+)/) || [])[1];
    if (fixture) {
      const fpath = join(cdir, fixture);
      if (!existsSync(fpath)) problems.push(`cases/${c}: case.yaml names ${fixture} but it is missing`);
      else {
        const src = readFileSync(fpath, 'utf8');
        // A fixture flagged for network use is reported, not run.
        if (/curl |wget |npm install|pip install|git clone http/.test(src)) problems.push(`cases/${c}/${fixture}: fixtures must not reach the network`);
        else if (!flag('no-fixtures')) {
          const tmp = mkdtempSync(join(tmpdir(), 'bg-fixture-'));
          const r = spawnSync('bash', ['-e', fpath], { cwd: tmp, encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME: tmp } });
          if (r.status !== 0) problems.push(`cases/${c}/${fixture}: exited ${r.status}${r.stderr ? ': ' + r.stderr.trim().split('\n').pop() : ''}`);
          rmSync(tmp, { recursive: true, force: true });
        }
      }
    }
  }
}

function checkBuild(root, problems) {
  const pj = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  if (!pj.name || !SLUG.test(pj.name)) problems.push('plugin.json: name must be kebab-case');
  if (!pj.version) problems.push('plugin.json: version is missing (users then track commits)');
  const bj = JSON.parse(readFileSync(join(root, 'buildguild.json'), 'utf8'));
  if (bj.slug !== pj.name) problems.push(`buildguild.json: slug "${bj.slug}" differs from plugin.json name "${pj.name}"`);
  problems.push(...validateManifest(bj));
  for (const d of ['skills', 'agents']) if (existsSync(join(root, d))) for (const n of readdirSync(join(root, d))) {
    const f = d === 'skills' ? join(root, d, n, 'SKILL.md') : join(root, d, n);
    if (!existsSync(f)) { problems.push(`${d}/${n}: missing ${d === 'skills' ? 'SKILL.md' : 'file'}`); continue; }
    const txt = readFileSync(f, 'utf8');
    if (!/^---[\s\S]*?\nname:\s*\S+[\s\S]*?\ndescription:\s*\S+[\s\S]*?\n---/.test(txt)) problems.push(`${d}/${n}: front matter needs name and description`);
  }
  if (existsSync(join(root, 'hooks/hooks.json'))) {
    const hj = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
    for (const [ev, groups] of Object.entries(hj.hooks || {})) for (const g of groups) for (const h of g.hooks || []) {
      const m = String(h.command || '').match(/\$\{CLAUDE_PLUGIN_ROOT\}"?\/([^\s"]+)/);
      if (m && !existsSync(join(root, m[1]))) problems.push(`hooks.json (${ev}): ${m[1]} does not exist`);
      if (m && !/^bash /.test(h.command)) problems.push(`hooks.json (${ev}): invoke scripts through "bash" so a lost executable bit cannot disable the hook`);
    }
  }
  if (existsSync(join(root, 'evals'))) for (const c of readdirSync(join(root, 'evals')).filter(n => n !== 'results')) { const gdir = join(root, 'evals', c, 'graders'); if (existsSync(gdir)) for (const g of readdirSync(gdir)) checkGrader(readFileSync(join(gdir, g), 'utf8'), `evals/${c}/graders/${g}`, problems); }
  const claude = which('claude');
  if (claude && !flag('no-validator')) {
    const r = spawnSync(claude, ['plugin', 'validate', root, '--strict'], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) problems.push(`claude plugin validate --strict failed:\n    ${(r.stdout + r.stderr).trim().split('\n').slice(-6).join('\n    ')}`);
  } else if (!claude) out('note: claude is not installed, skipped claude plugin validate');
}

// Every check `check` runs on a build or trial folder; any problem is listed and exits 1. A --trial folder gets it too.
function checkFolder(root, kind) {
  const problems = [];
  if (!existsSync(join(root, 'README.md'))) problems.push('README.md is missing');
  else if (words(readFileSync(join(root, 'README.md'), 'utf8')) < 40) problems.push('README.md needs at least forty words');
  if (!existsSync(join(root, 'LICENSE'))) problems.push('LICENSE is missing');
  for (const n of ['.env', '.env.local', 'id_rsa', 'credentials.json']) if (existsSync(join(root, n))) problems.push(`${n} must not ship in a submission`);
  if (kind === 'trial') checkTrial(root, problems); else checkBuild(root, problems);
  if (problems.length) { console.error(`${kind} ${root}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`); process.exit(1); }
}

function check(target) {
  const root = resolve(target || '.');
  const kind = existsSync(join(root, 'trial.json')) ? 'trial' : existsSync(join(root, 'buildguild.json')) ? 'build' : null;
  if (!kind) die(`${root} has neither buildguild.json (a build) nor trial.json (a trial)`);
  checkFolder(root, kind);
  out(`${kind} ${root}: ok (${kind === 'trial' ? 'manifest, cases, graders, fixtures' : 'manifest, skills, agents, hooks' + (which('claude') && !flag('no-validator') ? ', validator' : '')} checked)`);
}

async function publish(target) {
  const root = resolve(target || '.');
  const kind = existsSync(join(root, 'trial.json')) ? 'trial' : existsSync(join(root, 'buildguild.json')) ? 'build' : die(`${root} is neither a build nor a trial`);
  const manifest = JSON.parse(readFileSync(join(root, kind === 'trial' ? 'trial.json' : 'buildguild.json'), 'utf8'));
  const pj = kind === 'build' ? JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')) : null;
  const readme = existsSync(join(root, 'README.md')) ? readFileSync(join(root, 'README.md'), 'utf8') : '';
  const firstPara = readme.split(/\n\s*\n/).map(s => s.trim()).find(s => s && !s.startsWith('#')) || '';
  let repo = flag('repo');
  if (!repo) { const r = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }); if (r.status === 0) repo = r.stdout.trim().replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''); }
  if (!repo || !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo)) die('a public GitHub repository URL is needed: push the folder to GitHub, or pass --repo https://github.com/you/name');
  const github = flag('github') || (version('gh', ['api', 'user', '--jq', '.login']) || '').trim();
  if (!github) die('your GitHub login is needed: sign in with gh, or pass --github <login>');
  const email = flag('email') || (spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout || '').trim();
  if (!email) die('an email for the reply is needed: pass --email');
  const summary = String(flag('summary') || manifest.summary || pj?.description || firstPara).slice(0, 300);
  if (summary.length < 40) die('a summary of 40 to 300 characters is needed: pass --summary, or set it in the manifest');
  const body = { kind, repo, name: manifest.name || pj?.displayName || pj?.name || manifest.slug, summary, github, email, license: manifest.license || pj?.license || 'unknown', source: 'cli', rights: false, optIn: false, trialRules: kind === 'trial' ? false : undefined };
  out(`Checking ${root} first…`);
  const chk = spawnSync(process.execPath, [fileURLToPathSafe(), 'check', root], { stdio: 'inherit' });
  if (chk.status !== 0) die('fix the problems above, then publish again');
  out(`\nThis will be sent to ${ORIGIN}/api/submit:\n${JSON.stringify({ ...body, rights: '(your answer)', optIn: '(your answer)', trialRules: kind === 'trial' ? '(your answer)' : undefined }, null, 2)}\n`);
  const ask = async q => { if (flag('yes')) return true; process.stdout.write(q + ' [y/N] '); const a = await new Promise(res => { process.stdin.setEncoding('utf8'); process.stdin.once('data', d => res(String(d).trim())); }); return /^y(es)?$/i.test(a); };
  body.rights = await ask('I have the right to list this under that licence, and I agree to the code of conduct.');
  if (!body.rights) die('not sent: the rights declaration is required', 0);
  body.optIn = await ask(`List it under the name "${github}".`);
  if (!body.optIn) die('not sent: nothing is listed under a name without opt-in', 0);
  if (kind === 'trial') { body.trialRules = await ask('One dimension per case, deterministic graders, no network in fixtures, and I understand it never carries my own build above Tested.'); if (!body.trialRules) die('not sent: the trial rules are required', 0); }
  const res = await fetch(`${ORIGIN}/api/submit`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'buildguild-cli' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) die(`the guild refused the submission: ${data.error || res.status}`);
  out(`submitted (${data.id}). A maintainer runs the same checks, then lists it as Declared. Ask or follow up: ${ORIGIN.replace(/\/$/, '')}/submit/`);
}
function fileURLToPathSafe() { return new URL(import.meta.url).pathname; }

const help = `buildguild · the BuildGuild companion (${ORIGIN})
Run from a checkout of the Build repository; the buildguild npm package is not published yet, so do not run it with npx.

  node cli/buildguild.mjs list          builds this season with tiers
  node cli/buildguild.mjs show <slug>   one build's modules, profiles, evidence
  node cli/buildguild.mjs add <slug> [--scope project|user] [--target claude|codex|all]
                                        download, verify SHA-256, unpack, record in .buildguild/lock.json
  node cli/buildguild.mjs remove <slug> reverse an add
  node cli/buildguild.mjs doctor        which runtimes are installed, what the lock says
  node cli/buildguild.mjs new build <name> | new trial <name> [--author login] [--license id]
                                        scaffold a build (plugin + buildguild.json) or a trial (trial.json + one case) that passes check
  node cli/buildguild.mjs check [path]  manifest, skills, agents, hooks and the plugin validator for a build; manifest, cases,
                                        grader front matter and fixture scripts for a trial. Run this before anything else
  node cli/buildguild.mjs publish [path] [--repo url] [--github login] [--email a] [--summary s] [--yes]
                                        check, show the submission, ask for the consents, then post it to the guild
  node cli/buildguild.mjs trial [slug]  download a trial's cases into .buildguild/trials/
  node cli/buildguild.mjs test <slug|path> --model <id> [--trial slug|path] [--max-cost-usd 5] [--runs n] [-j n] [--out evidence.json] [--raw-out raw.json] [--work-dir dir]
                                        run a published trial (default guild-smoke-v1) with claude plugin eval (Claude Code 2.1.269+) in a temp copy,
                                        write an evidence file. A trial folder of your own is checked first; its run goes to local-run.json, not evidence.
                                        --model names the model it runs on (the hosted season trial: claude-sonnet-5-5); ANTHROPIC_MODEL may stand in
                                        --work-dir is deleted first, so it may not be /, home, the current directory or above, or in or around the build or trial folder
  node cli/buildguild.mjs wrap <aggregate.json> --build <slug> --trial <slug|path> --model <id> [--build-version v] [--runner login]
                                        convert a raw eval report into buildguild.evidence.v1 naming the model it ran on (from a trial folder: a local record)
  node cli/buildguild.mjs submit <evidence.json> [--yes]
                                        publish as a public Gist from your GitHub account and send the summary; refuses a local run
`;

(async () => {
  if (cmd === 'wrap') modelId(); // its case fetches the trial record first; a missing model is refused before any request
  switch (cmd) {
    case 'list': return list();
    case 'show': return show(positional[0]);
    case 'add': return add(positional[0]);
    case 'remove': return remove(positional[0]);
    case 'doctor': return doctor();
    case 'new': return positional[0] === 'build' ? newBuild(positional[1]) : positional[0] === 'trial' ? newTrial(positional[1]) : die('usage: buildguild new build <name> | new trial <name>');
    case 'check': return check(positional[0]);
    case 'publish': return publish(positional[0]);
    case 'trial': return trial(positional[0]);
    case 'test': return test(positional[0]);
    case 'wrap': {
      const local = localTrial(flag('trial'));
      // A local run's raw report can only become a local record, so it is refused for a published slug before any lookup.
      if (!local && JSON.parse(readFileSync(positional[0], 'utf8')).trialSource === 'local') die(`${positional[0]} is the report of a run on a local trial folder, which is never evidence for a published trial; wrap it with --trial <that folder>`);
      const t = local ? local.record : await fetchJson(`/trials/${trialSlugOf(flag('trial', 'guild-smoke-v1'))}.json`);
      const ev = wrap(positional[0], { build: slugOf(flag('build'), 'build'), buildVersion: flag('build-version', 'local'), trialRecord: t, local: !!local, sha256: flag('sha256', null), role: flag('role', 'author'), runner: flag('runner', 'unknown') });
      return out(JSON.stringify(ev, null, 2));
    }
    case 'submit': return submit(positional[0]);
    default: out(help); process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0);
  }
})().catch(err => die(err.message));
