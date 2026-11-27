#!/usr/bin/env node
// buildguild: the BuildGuild command-line companion. Node 22+, zero dependencies.
// list | show | add | remove | doctor | trial | unpublished | test | wrap | submit
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, rmdirSync, readdirSync, statSync, lstatSync, realpathSync, cpSync, mkdtempSync, accessSync, constants } from 'node:fs';
import { join, dirname, basename, resolve, relative, parse, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { homedir, platform, release, tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { validateManifest, LICENSES, MODULE_TYPES } from './manifest.mjs';
import { compare } from './compare.mjs';
import { prepareComparison } from './comparison-preparation.mjs';
import { trialTemplateFiles } from './trial-templates.mjs';
import { checkExamples } from './grader-examples.mjs';
import { attemptStatus, pluginLoaded } from './comparison-results.mjs';
import { CASE_PATH_NAME, DEFINITION_BYTES, GRADER_FILES, GRADER_KEYS, GRADER_TEMPLATE, GRADER_TYPES, PROMPT_KEYS, PROMPT_TEMPLATE, WORD, caseYamlKeys, frontMatter } from './unpublished-form.mjs';

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

async function fetchJson(path, signal) {
  const res = await fetch(`${ORIGIN}${path}`, { signal, headers: { accept: 'application/json', 'user-agent': 'buildguild-cli' } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
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

async function modulePins(bundleDir) {
  let refs = [];
  try {
    const manifest = JSON.parse(readFileSync(join(bundleDir, 'buildguild.json'), 'utf8'));
    if (Array.isArray(manifest.modules)) refs = manifest.modules;
  } catch {}
  // Local builds need not have passed check; keep even malformed manifests within the evidence API's contract.
  const modules = refs.filter(ref => {
    const parts = typeof ref === 'string' ? ref.split('/') : [];
    return parts.length === 2 && MODULE_TYPES.includes(parts[0]) && SLUG.test(parts[1]);
  }).slice(0, 60).map(ref => ({ ref, sha: null }));
  let sources = new Map();
  try {
    const index = await fetchJson('/modules/index.json', AbortSignal.timeout(15000));
    sources = new Map(index.modules.map(m => [`${m.type}/${m.slug}`, m.source]));
  } catch {}
  for (const pin of modules) {
    const source = sources.get(pin.ref);
    if (source?.kind !== 'github' || typeof source.url !== 'string') continue;
    // This parser supports single-segment branch names only in GitHub tree URLs.
    const match = source.url.match(/^(https:\/\/github\.com\/[^/]+\/[^/?#]+)(?:\/tree\/([^/?#]+)(?:\/[^?#]*)?)?\/?$/);
    if (!match) continue;
    try {
      const output = execFileSync('git', ['ls-remote', match[1], match[2] ? `refs/heads/${match[2]}` : 'HEAD'], {
        encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const sha = output.trim().split(/\s+/)[0];
      if (/^[0-9a-f]{40}$/.test(sha)) pin.sha = sha;
    } catch {}
  }
  out(`pinned ${modules.filter(m => m.sha).length} of ${modules.length} modules`);
  return modules;
}

// ---------- unpublished cases ----------
// A guild maintainer runs a private folder of cases as the unpublished part (the hidden slice) of a published trial. The mode
// takes one kind of run: a published build (an archive whose SHA-256 is checked), on the folder's cases exactly as their
// checksum fixes them, in the public trial's form, once. It creates its outputs and overwrites and deletes nothing. Its
// record names the cases only by number.
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
// Every refusal of this mode that needs nothing to run goes through refuse, named by why. tests/unpublished-cases.test.mjs holds
// one row per name and fails while a name has none, so a refusal added later cannot go untested.
const refuse = (why, message) => die(message);
// The count and checksum of the unpublished cases, published before the run. files is filesIn(<folder>/cases), the very
// bytes the run is given. The checksum is the SHA-256 of one line per regular file, "<mode> <sha256 of its bytes> cases/<path>\n",
// sorted by the bytes of the path; mode is the one the run writes (755 for .sh, 644 otherwise). No file time, folder path or
// listing order enters it, so the same cases give the same checksum on any machine. Every name in a path is from the allow-list
// unpublishedFolder applies, so every path fits on its line.
function casesDigest(files, count) {
  const paths = Object.keys(files).sort(byteOrder);
  const lines = paths.map(rel => `${modeFor(rel).toString(8)} ${createHash('sha256').update(files[rel]).digest('hex')} cases/${rel}\n`).join('');
  return { count, sha256: createHash('sha256').update(lines).digest('hex') };
}
// The case form's specification is in unpublished-form.mjs; readExact and refuseOutsideForm apply it, refusing by name.
// Reads lines in the exact form, or refuses at the first line outside it: each is "key: value", the key a bare lower-case word
// from spec given once, the value one its form takes. A key with `nested` may instead have no value, and is then followed by
// exactly its nested keys' lines, in that order, each indented by two spaces. first is the file's line number of lines[0].
function readExact(lines, spec, where, first) {
  const keys = {};
  for (let i = 0; i < lines.length; i++) {
    const at = `${where}, line ${first + i}`;
    const m = lines[i].match(/^([a-z_]+):(?: (.*))?$/);
    if (m === null) refuse('form-line', `${at} is not a "key: value" line of the form this mode takes; nothing was run`);
    const [, key, value] = m, form = spec[key];
    if (form === undefined) refuse('form-line', `${at}: ${key} is not a key this mode takes there (it takes ${Object.keys(spec).join(', ')}); nothing was run`);
    if (key in keys) refuse('form-line', `${at}: ${key} is given twice; nothing was run`);
    if (value !== undefined) {
      if (!form.value?.(value)) refuse('form-line', `${at}: the value of ${key} is not ${form.says}; nothing was run`);
      keys[key] = value;
      continue;
    }
    if (form.nested === undefined) refuse('form-line', `${at}: ${key} has no value; it takes ${form.says}. Nothing was run.`);
    keys[key] = {};
    for (const [sub, accepts] of form.nested) {
      i += 1;
      const n = (lines[i] ?? '').match(/^ {2}([a-z_]+): (.*)$/);
      if (n === null || n[1] !== sub || !accepts(n[2])) refuse('form-line', `${where}, line ${first + i}: ${key} takes ${form.says}; nothing was run`);
      keys[key][sub] = n[2];
    }
  }
  return keys;
}
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function refuseOutsideForm(root, names, files, entries) {
  const at = rel => `${root}/cases/${rel}`;
  const textOf = rel => {
    if (files[rel].length > DEFINITION_BYTES) refuse('form-size', `${at(rel)} is ${files[rel].length} bytes; the runner reads at most ${DEFINITION_BYTES}. Nothing was run.`);
    let text = null;
    try { text = UTF8.decode(files[rel]); } catch {}
    if (text === null || text.includes('\r')) refuse('form-text', `${at(rel)} is not UTF-8 text without carriage returns, the form this mode takes; nothing was run`);
    return text;
  };
  // cases/ holds the case folders and nothing else; no case folder has a plugin manifest at its top, which the runner would
  // load for that case in place of the build; and graders/ holds grader files, <name>.md, only.
  for (const rel of entries) {
    const parts = rel.split('/');
    if (parts.length === 1 && files[rel] !== undefined) refuse('form-file', `${at(rel)} is a file at the top of cases/, which holds only the case folders; nothing was run`);
    if (parts.length === 2 && (parts[1] === 'plugin.json' || parts[1] === '.claude-plugin')) refuse('form-file', `${at(rel)} would make the runner load the case folder as a plugin in place of the build; nothing was run`);
    if (parts.length >= 3 && parts[1] === 'graders' && (parts.length > 3 || !parts[2].endsWith('.md') || files[rel] === undefined)) refuse('form-file', `${at(rel)}: graders/ holds grader files only, each <name>.md; nothing was run`);
  }
  for (const n of names) {
    const graderFiles = Object.keys(files).filter(rel => rel.startsWith(`${n}/graders/`)).length;
    if (graderFiles > GRADER_FILES) refuse('form-size', `${at(`${n}/graders`)} holds ${graderFiles} grader files; the runner reads at most ${GRADER_FILES}. Nothing was run.`);
    if (files[`${n}/case.yaml`] !== undefined) {
      const rel = `${n}/case.yaml`;
      const keys = readExact(textOf(rel).replace(/\n$/, '').split('\n'), caseYamlKeys(n, name => files[`${n}/${name}`] !== undefined), at(rel), 1);
      for (const key of ['schema_version', 'name']) if (!(key in keys)) refuse('form-missing', `${at(rel)} has no ${key}; nothing was run`);
    }
    const promptRel = `${n}/prompt.md`;
    if (files[promptRel] === undefined) refuse('form-missing', `${at(n)} has no prompt.md; in this mode each case has one, its front matter and then its prompt. Nothing was run.`);
    const prompt = frontMatter(textOf(promptRel));
    if (prompt === null) refuse('form-front-matter', `${at(promptRel)} does not open with a line that is exactly "---" and close its front matter with the next such line, with no other "---" between; nothing was run`);
    readExact(prompt.lines, PROMPT_KEYS, at(promptRel), 2);
    if (!prompt.body.trim() || prompt.body.includes(PROMPT_TEMPLATE)) refuse('form-missing', `${at(promptRel)} has no prompt after its front matter, or only the runner's blank template; nothing was run`);
    for (const rel of Object.keys(files).filter(rel => rel.startsWith(`${n}/graders/`)).sort(byteOrder)) {
      const grader = frontMatter(textOf(rel));
      if (grader === null) refuse('form-front-matter', `${at(rel)} does not open with a line that is exactly "---" and close its front matter with the next such line, with no other "---" between (the runner skips a grader file without front matter); nothing was run`);
      const keys = readExact(grader.lines, GRADER_KEYS, at(rel), 2);
      // The type's own rule takes only a type GRADER_TYPES lists.
      if (!('type' in keys)) refuse('form-missing', `${at(rel)} has no type; nothing was run`);
      const kind = GRADER_TYPES[keys.type];
      for (const key of Object.keys(keys)) if (!kind.keys.includes(key)) refuse('form-line', `${at(rel)}: ${key} is not a key of a ${keys.type} grader here (it takes ${kind.keys.join(', ')}); nothing was run`);
      for (const key of kind.needs) if (!(key in keys)) refuse('form-missing', `${at(rel)}: a ${keys.type} grader needs ${key}; nothing was run`);
      for (const key of ['pattern', 'input_match']) {
        if (!(key in keys)) continue;
        const text = keys[key].slice(1, -1);
        try { new RegExp(text, key === 'pattern' ? keys.flags ?? '' : ''); } catch { refuse('form-line', `${at(rel)}: ${key} is not a valid regular expression${key === 'pattern' && keys.flags ? ` with the flags ${keys.flags}` : ''}; nothing was run`); }
        if (key === 'pattern' && text.includes(GRADER_TEMPLATE)) refuse('form-missing', `${at(rel)}: pattern is still the runner's blank template; nothing was run`);
      }
    }
  }
}
// The folder of the run folder the cases are written to, and the --eval-dir value the runner is given. In Claude Code 2.1.321
// the loader treats the one value "evals" as a search: it opens every folder of that name below the plugin root, and takes the
// plugin root itself for the suite when that root's path holds a folder of that name. Any other relative value opens exactly
// <frame root>/<value> and walks only the folders on the way to it, for a target with an ordinary name: a target named
// case.yaml or prompt.md is taken for a case's file and its folder for the case, so a run folder of either name loads no case
// and gives no record (cli/README.md, "Left to the runner, and the rehearsal"). For `plugin eval .` the frame root is the
// plugin root the runner resolves for the target (Ng), the run folder, or none when it does not trust that folder yet; with
// none, the value is taken from the target, the run folder again, and a target whose path ends with the value is taken for the
// suite, so a run folder named like this one is refused.
const EVAL_FOLDER = 'unpublished-cases';
// A case folder's name: lower-case letters, digits and hyphens, starting with a letter or digit, text to YAML, and none of the
// names the runner's case discovery skips (Claude Code 2.1.321 skips node_modules, .claude, results and mocks, and .git in any
// case; the pattern already leaves out all but results and mocks).
const SKIPPED_BY_DISCOVERY = new Set(['node_modules', '.claude', 'results', 'mocks', '.git']);
const caseNameOk = name => WORD(name) && !SKIPPED_BY_DISCOVERY.has(name);
// --unpublished <folder> (a path: onlyFlags has refused the flag without one), read without running anything: the roster
// (trial.json lists each case once, by name, and its list is exactly the folders under cases/), the case names, the structure
// (every check `check` runs on a trial folder except running its fixtures), the names under cases/, then the cases' bytes,
// read once: the public trial's form is checked on them, and their checksum and each case's graders (its graders/*.md, by file
// name) are taken from them.
function unpublishedFolder(value) {
  const root = resolve(value);
  if (!existsSync(root) || !statSync(root).isDirectory()) refuse('folder-absent', `no trial folder at ${root}; nothing was run`);
  if (!existsSync(join(root, 'trial.json'))) refuse('folder-no-trial', `${root} has no trial.json, so it is not a trial folder; nothing was run`);
  let record;
  try { record = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8')); } catch (err) { refuse('folder-json', `${root}/trial.json is not valid JSON (${err.message}); nothing was run`); }
  const casesDir = join(root, 'cases');
  const dirs = existsSync(casesDir) && lstatSync(casesDir).isDirectory() ? readdirSync(casesDir).filter(n => lstatSync(join(casesDir, n)).isDirectory()) : [];
  if (!dirs.length || !Array.isArray(record?.cases) || !record.cases.length) refuse('folder-no-case', `${root} has no case: it needs at least one folder under cases/ and the same names in trial.json; nothing was run`);
  const names = record.cases.map(c => c?.name);
  if (names.some(n => typeof n !== 'string' || !n)) refuse('roster-name', `${root}/trial.json lists a case without a name; nothing was run`);
  const twice = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].sort(byteOrder);
  if (twice.length) refuse('roster-twice', `${root}/trial.json lists ${twice.join(', ')} more than once; each case is listed once. Nothing was run.`);
  const listed = [...names].sort(byteOrder), found = [...dirs].sort(byteOrder);
  if (listed.join('\n') !== found.join('\n')) refuse('roster-mismatch', `${root}/trial.json lists ${listed.length} cases and cases/ holds ${found.length} folders, and the two do not match; nothing was run`);
  const badCase = listed.find(n => !caseNameOk(n));
  if (badCase !== undefined) refuse('case-name', `${casesDir}/${badCase} is not a case name this mode takes: lower-case letters, digits and hyphens, starting with a letter or digit; not a word YAML reads as other than text (true, false, null, yes, no, on, off, y, n, a number or a date); and not a name the runner's case discovery skips (results, mocks, node_modules, .claude, .git). Rename it. Nothing was run.`);
  const problems = folderProblems(root, 'trial', { structuralOnly: true });
  if (problems.length) refuse('structure', `trial ${root}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
  const entries = walk(casesDir);
  const badName = entries.find(rel => { const name = rel.split('/').pop(); return !CASE_PATH_NAME.test(name) || name === '.' || name === '..'; });
  if (badName !== undefined) refuse('file-name', `${casesDir} holds a name outside the allowed ones (letters, digits, ".", "_" and "-"): ${JSON.stringify(badName)}; rename it. Nothing was run.`);
  const files = filesIn(casesDir);
  refuseOutsideForm(root, names, files, entries);
  const graders = Object.fromEntries(names.map(n => [n, Object.keys(files).filter(rel => rel.startsWith(`${n}/graders/`)).map(rel => basename(rel, '.md')).sort(byteOrder)]));
  return { root, record, files, graders, ...casesDigest(files, names.length) };
}
// With --unpublished, --trial names the published trial the cases belong to, by slug; a folder is refused.
function publishedSlugFor(value) {
  if (value === undefined || value === true) refuse('trial-missing', '--unpublished needs --trial <slug>, the published trial these cases are the unpublished part of; nothing was run');
  if (value.startsWith('.') || /[\\/]/.test(value) || existsSync(join(value, 'trial.json'))) refuse('trial-folder', `--trial ${value} is a folder; with --unpublished, --trial names the published trial by its slug, and the folder of unpublished cases goes to --unpublished. Nothing was run.`);
  if (!SLUG.test(value)) refuse('trial-slug', `--trial ${JSON.stringify(value)} is not a kebab-case slug; nothing was run`);
  return value;
}
// The record of a run on unpublished cases is always a guild run.
function guildRoleOnly() {
  const role = flag('role');
  if (role !== undefined && role !== 'guild') refuse('role', `a run on unpublished cases is a guild run, so --role must be guild or left out (got ${JSON.stringify(role)}); nothing was run`);
}
// A case may not share a name with a case of the published trial: the record numbers the unpublished cases, and a reader
// must never be able to take one for a published case.
function refuseSharedNames(folder, published) {
  const names = new Set((published.cases || []).map(c => c.name));
  const shared = [...new Set([...folder.record.cases.map(c => c.name), ...readdirSync(join(folder.root, 'cases'))])].filter(n => names.has(n)).sort(byteOrder);
  if (shared.length) refuse('shared-name', `${shared.length === 1 ? 'a case' : `${shared.length} cases`} in ${folder.root} ${shared.length === 1 ? 'has' : 'have'} the name of a case of the published trial ${published.slug} (${shared.join(', ')}); rename ${shared.length === 1 ? 'it' : 'them'}. Nothing was run.`);
}
// The flags each command of this mode accepts; any other is refused by name, and none may be given twice. --runs is refused
// because the number of runs is part of each case, which the checksum fixes; --no-fixtures because it skips the check every
// folder gets; the rest because they are not part of this mode.
const UNPUBLISHED_FLAGS = {
  test: ['trial', 'unpublished', 'model', 'runner', 'role', 'max-cost-usd', 'j', 'rep', 'out', 'raw-out', 'work-dir', 'keep-temp'],
  wrap: ['trial', 'unpublished', 'model', 'runner', 'role', 'build', 'build-version', 'sha256', 'out'],
  unpublished: [],
};
const REFUSED_BECAUSE = { runs: 'the number of runs is part of each case, which the checksum fixes', 'no-fixtures': 'every unpublished folder gets the fixture check' };
const VALUE_FLAGS = ['trial', 'unpublished', 'model', 'runner', 'role', 'max-cost-usd', 'j', 'rep', 'out', 'raw-out', 'work-dir', 'build', 'build-version', 'sha256'];
function onlyFlags(command) {
  const accepted = UNPUBLISHED_FLAGS[command];
  const seen = new Set();
  for (const a of args.slice(1).filter(a => a.startsWith('-'))) {
    const name = a.replace(/^--?/, '');
    if (!accepted.includes(name) || a !== (name.length === 1 ? `-${name}` : `--${name}`)) refuse('flag', `${a} is not accepted ${command === 'unpublished' ? 'by unpublished' : `by ${command} --unpublished`}${REFUSED_BECAUSE[name] ? `: ${REFUSED_BECAUSE[name]}` : ''}. ${accepted.length ? `It accepts ${accepted.map(n => n.length === 1 ? `-${n}` : `--${n}`).join(', ')}.` : 'It takes no flag.'} Nothing was run.`);
    if (seen.has(name)) refuse('flag', `${a} is given twice; nothing was run`);
    seen.add(name);
    if (VALUE_FLAGS.includes(name) && flag(name) === true) refuse('flag-value', `${a} needs a value; nothing was run`);
  }
}
// A path this mode creates: a file (--out, --raw-out) or the run folder (--work-dir). It must not exist yet; its parent folder
// must, and this user must be able to create a file in it; and it may not lie inside the unpublished folder. Files are created
// with exclusive creation ('wx', in createNew) and the run folder with mkdir, so a path that appears in the meantime fails
// instead of being written through: this mode overwrites and deletes nothing.
function newOutput(name, value, folderRoot) {
  const p = resolve(String(value));
  let exists = true;
  try { lstatSync(p); } catch { exists = false; }
  if (exists) refuse('output-exists', `${name} ${p} already exists; this mode creates its outputs and overwrites nothing. Nothing was run.`);
  let parent = null;
  try { parent = realpathSync.native(dirname(p)); } catch {}
  if (parent === null || !statSync(parent).isDirectory()) refuse('output-parent', `${name} ${p} is not in an existing folder; nothing was run`);
  const real = join(parent, basename(p)), folder = realpathSync.native(folderRoot);
  if (real.startsWith(folder + sep)) refuse('output-in-folder', `${name} ${p} is inside the unpublished folder ${folder}; this mode writes nothing there. Nothing was run.`);
  try { accessSync(parent, constants.W_OK | constants.X_OK); } catch { refuse('output-unwritable', `${name} ${p} is in a folder this user cannot create files in, ${parent}; nothing was run`); }
  return real;
}
// Creates an output with exclusive creation. A file that appeared at the path after the preflight is left as it is, and the
// command stops; `then` says what was kept.
function createNew(name, path, text, then) {
  try { writeFileSync(path, text, { flag: 'wx' }); } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    die(`${name} ${path} appeared after the checks and was left as it is; ${then}`);
  }
}
// A record from the site, read before anything runs; a failed read is a refusal.
async function lookUp(path, why, what) {
  try { return await fetchJson(path); } catch (err) { refuse(why, `${what} could not be read from ${ORIGIN} (${err.message}); nothing was run`); }
}
// Prints the count and checksum of a folder's unpublished cases without running anything, so both can be published first.
function unpublished(target) {
  onlyFlags('unpublished');
  if (!target) die('usage: buildguild unpublished <trial-folder>');
  const folder = unpublishedFolder(target);
  out(`${folder.count} unpublished case${folder.count === 1 ? '' : 's'}\nsha256 ${folder.sha256}\nunpublishedCases ${JSON.stringify({ count: folder.count, sha256: folder.sha256 })}`);
}

// The dimensions of a run, as the trial page publishes them: each dimension is the mean score of its cases, reliability is the
// score of the reliability case, and cost is 1 minus (list-price USD per passed case) / 2, clamped to 0..1.
function dimensionsOf(raw, dimensionOf, reliabilityCase = 'fix-the-failing-test') {
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
  if (typeof raw.costUsd === 'number' && passed > 0) dims.cost = Number(Math.max(0, Math.min(1, 1 - (raw.costUsd / passed) / 2)).toFixed(3));
  return dims;
}

// Each case's dimension comes from the trial record; the eval report itself carries no tags. Every record names the trial
// version it ran, which the tier rules count by; a run on a local trial folder is also marked trialSource "local", so
// submit can refuse it.
function wrap(rawPath, { build, buildVersion, trialRecord, local = false, sha256, role, runner, modules = [], reliabilityCase = 'fix-the-failing-test', idSuffix = '' }) {
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const dims = dimensionsOf(raw, name => trialRecord.cases.find(c => c.name === name)?.dimension || null, reliabilityCase);
  const passed = raw.aggregates?.casesPassed ?? 0;
  return {
    schema: 'buildguild.evidence.v1', id: `${new Date().toISOString().slice(0, 10)}-${runner}-${Math.random().toString(36).slice(2, 8)}${idSuffix}`,
    build, buildVersion, archiveSha256: sha256 || null, trial: trialRecord.slug, trialVersion: trialRecord.version, ...(local ? { trialSource: 'local' } : {}), date: new Date().toISOString().slice(0, 10), runner, role, gist: null,
    environment: { ...fingerprint(), claudeCode: raw.claudeVersion || fingerprint().claudeCode, modules },
    results: { overallScore: raw.aggregates?.overallScore ?? 0, casesPassed: passed, casesTotal: raw.aggregates?.casesTotal ?? 0, meanDelta: raw.aggregates?.meanDelta ?? null, dimensions: dims, partial: !!raw.partial, cases: (raw.cases || []).map(c => ({ name: c.name, score: c.aggregates?.score ?? null, delta: c.aggregates?.delta ?? null })) },
    cost: typeof raw.costUsd === 'number' ? { usd: Number(raw.costUsd.toFixed(4)) } : null,
    durationSeconds: raw.durationSeconds ?? null,
  };
}

// The raw report of a run with --unpublished carries a marker, unpublishedRun, with every fact its record needs from the run:
// the published trial and version, the cases (their real names, their dimensions and their graders at the run: the report is
// private), their count and checksum, the build, its version and archive checksum, the plugin the run loads (the name and version
// its manifest gives, and the run folder it loads from), the runner, the date, the --rep suffix, the environment and the runner's
// exit status. test writes it; wrap rebuilds the record from it alone, so the two records are the same apart from the id's random
// part, and both apply the same rules to it.
const SHA256_HEX = /^[0-9a-f]{64}$/;
const isText = v => typeof v === 'string' && v.length > 0;
const uniqueTexts = list => Array.isArray(list) && list.length > 0 && list.every(isText) && new Set(list).size === list.length;
function validMarker(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return false;
  const cases = Array.isArray(run.cases) ? run.cases : [];
  return isText(run.trial) && isText(run.trialVersion) && Number.isInteger(run.count) && run.count > 0 && typeof run.sha256 === 'string' && SHA256_HEX.test(run.sha256)
    && cases.length === run.count && cases.every(c => isText(c?.name) && isText(c?.dimension) && uniqueTexts(c?.graders)) && uniqueTexts(cases.map(c => c.name))
    && isText(run.build) && isText(run.buildVersion) && typeof run.archiveSha256 === 'string' && SHA256_HEX.test(run.archiveSha256) && isText(run.runner)
    && typeof run.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(run.date) && typeof run.idSuffix === 'string'
    && (Number.isInteger(run.runnerExit) || isText(run.runnerExit))
    && typeof run.plugin === 'object' && run.plugin !== null && isText(run.plugin.name) && isText(run.plugin.version) && isText(run.plugin.path) && isAbsolute(run.plugin.path)
    && typeof run.environment === 'object' && run.environment !== null && ['os', 'claudeCode', 'model'].every(k => isText(run.environment[k])) && Array.isArray(run.environment.modules);
}
// A record is written only for a complete run on exactly the folder's cases. The runner (Claude Code 2.1.321) exits 0 when it
// finished; 1 when a case scored under --threshold (0 here, so no case can), a case did not load, the harness failed, a run
// ended on an API error, or its git check failed; 2 for a partial report (the cost ceiling, an interruption, a failed sign-in);
// 130 when interrupted before any case ran. Only 0 is taken. The report must not be partial; it must have run with and
// without the build, on the model the record names (when it says which); it must show the build loaded in the arm with it, as
// pluginLoaded in comparison-results.mjs reads a report (one plugin, the build's name and version from its manifest, from the
// run folder, which is the suite's root, and no problem reported for it); it holds one result for each case and no other, each
// from the run folder's unpublished-cases/<name> where the report says where a case came from, with totals that agree; each arm of each case holds exactly the runs the case declares; and each run is complete, as attemptStatus
// in comparison-results.mjs classifies runs, with gradedErrors: the runner graded it (every grader of the case scored, a score
// from 0 to 1, no paid grader skipped) and did not abort it. A run that ended in an ordinary error (out of turns, say) and was
// still graded is a measurement, as in every record; a run the runner aborted, or that never reached grading (an API error, a
// failed scaffold), is not. Each score must be the one its parts give (a case's score is the mean of its runs, its gap is its
// score minus its bare score, and the overall score and gap are the means over the cases). Cases are named by their number.
// Both test and wrap call this; the problems it returns mean no record is written.
const finite = v => typeof v === 'number' && Number.isFinite(v);
const meanOf = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const agree = (a, b) => Math.abs(a - b) <= 1e-9;
const EXIT_MEANS = { 1: 'a case under --threshold, a case that did not load, a harness failure, a run that ended on an API error, or a failed git check', 2: 'a partial report: the cost ceiling, an interruption or a failed sign-in', 130: 'interrupted before any case ran' };
function unpublishedRunProblems(raw, run) {
  const problems = [];
  if (run.runnerExit !== 0) problems.push(`the runner exited ${run.runnerExit}${EXIT_MEANS[run.runnerExit] ? ` (${EXIT_MEANS[run.runnerExit]})` : ''}, not 0`);
  if (raw.partial || raw.partialReason) problems.push(`the run is partial${raw.partialReason ? ` (${raw.partialReason})` : ''}: it stopped before every case had run`);
  const suite = raw.suite && typeof raw.suite === 'object' ? raw.suite : {};
  if (suite.ablation !== undefined && suite.ablation !== 'with-without') problems.push(`the run did not compare the build with the bare runtime (ablation ${JSON.stringify(suite.ablation)})`);
  if (suite.modelOverride !== undefined && suite.modelOverride !== run.environment.model) problems.push(`the runner ran ${suite.modelOverride}, not ${run.environment.model}`);
  if (!pluginLoaded(suite, run.plugin)) {
    const said = Array.isArray(suite.plugins) && suite.plugins.length ? suite.plugins.map(entry => `${entry?.name} ${entry?.version ?? '(no version)'}${entry?.problem ? ` with the problem ${entry.problem}` : ''}`).join(', ') : 'none';
    problems.push(`the report does not show the build loaded in the run with it: it must name one plugin, ${run.plugin.name} ${run.plugin.version}, loaded from the run folder with no problem reported for it (it names ${said})`);
  }
  const numberOf = new Map(run.cases.map(c => c.name).sort(byteOrder).map((name, i) => [name, `unpublished-${i + 1}`]));
  const gradersOf = new Map(run.cases.map(c => [c.name, c.graders]));
  const cases = Array.isArray(raw.cases) ? raw.cases : [];
  const seen = new Map();
  for (const c of cases) seen.set(c?.name, (seen.get(c?.name) || 0) + 1);
  const twice = [...numberOf].filter(([name]) => seen.get(name) > 1).map(([, n]) => n);
  const missing = [...numberOf].filter(([name]) => !seen.has(name)).map(([, n]) => n);
  const unknown = cases.filter(c => !numberOf.has(c?.name)).length;
  if (twice.length) problems.push(`the report holds more than one result for ${twice.join(', ')}`);
  if (missing.length) problems.push(`the report holds no result for ${missing.join(', ')}`);
  if (unknown) problems.push(`the report holds ${unknown} result${unknown === 1 ? '' : 's'} for a case the folder does not list`);
  const totals = raw.aggregates || {};
  if (totals.casesTotal !== numberOf.size || cases.length !== numberOf.size) problems.push(`the report counts ${totals.casesTotal} cases and lists ${cases.length}, and the folder has ${numberOf.size}`);
  for (const c of cases) {
    // A result for a case the folder does not list is reported above, once; its runs are not checked.
    if (!numberOf.has(c?.name)) continue;
    const where = numberOf.get(c.name);
    if (c.dir !== undefined && c.dir !== `${EVAL_FOLDER}/${c.name}`) problems.push(`${where}: the report says the case was read from another folder than the run folder's ${EVAL_FOLDER}/`);
    const declared = Number.isInteger(c.runsPerCase) && c.runsPerCase > 0 ? c.runsPerCase : null;
    if (declared === null) problems.push(`${where}: the report does not say how many runs the case declares`);
    const scores = {};
    for (const [arm, label] of [['with', 'with the build'], ['without', 'of the bare runtime']]) {
      const attempts = c.arms?.[arm];
      if (!Array.isArray(attempts) || !attempts.length) { problems.push(`${where}: the report holds no run ${label}`); continue; }
      if (declared !== null && attempts.length !== declared) problems.push(`${where}: ${attempts.length} runs ${label}, where the case declares ${declared}`);
      const status = attempts.map(a => attemptStatus(a, gradersOf.get(c.name), { gradedErrors: true }));
      if (status.includes('error')) problems.push(`${where}: a run ${label} was aborted`);
      if (status.includes('ungraded')) problems.push(`${where}: a run ${label} was not graded (a grader went unscored or missing, its score is not from 0 to 1, or paid graders were skipped)`);
      if (status.includes('missing')) problems.push(`${where}: a run ${label} is missing from the report`);
      if (status.every(s => s === 'accepted' || s === 'failed')) scores[arm] = meanOf(attempts.map(a => a.score));
    }
    const g = c.aggregates || {};
    if (!finite(g.score) || !finite(g.scoreWithout) || !finite(g.delta)) { problems.push(`${where}: the case has no score for both arms and no gap between them`); continue; }
    if (scores.with !== undefined && !agree(g.score, scores.with)) problems.push(`${where}: its score ${g.score} is not the mean of its runs with the build (${scores.with})`);
    if (scores.without !== undefined && !agree(g.scoreWithout, scores.without)) problems.push(`${where}: its bare score ${g.scoreWithout} is not the mean of its bare runs (${scores.without})`);
    if (!agree(g.delta, g.score - g.scoreWithout)) problems.push(`${where}: its gap ${g.delta} is not its score minus its bare score`);
  }
  const caseScores = cases.map(c => c?.aggregates?.score), caseGaps = cases.map(c => c?.aggregates?.delta);
  if (!finite(totals.overallScore) || (cases.length && caseScores.every(finite) && !agree(totals.overallScore, meanOf(caseScores)))) problems.push(`the overall score ${totals.overallScore} is not the mean of the case scores`);
  if (!finite(totals.meanDelta) || (cases.length && caseGaps.every(finite) && !agree(totals.meanDelta, meanOf(caseGaps)))) problems.push(`the mean gap ${totals.meanDelta} is not the mean of the case gaps`);
  if (!Number.isInteger(totals.casesPassed) || totals.casesPassed < 0 || totals.casesPassed > numberOf.size) problems.push(`the report says ${totals.casesPassed} cases passed of ${numberOf.size}`);
  return problems;
}
// The note both test and wrap print when graded runs ended in an error, as an ordinary run notes its errored runs.
function gradedErrorNote(raw) {
  const runs = (raw.cases || []).flatMap(c => [...(c.arms?.with || []), ...(c.arms?.without || [])]);
  const errored = runs.filter(a => a?.error).length;
  if (errored) console.error(`note: ${errored} of ${runs.length} runs ended in an error and were still graded; the record counts them as measured, as any record does`);
}

// The record of a run on unpublished cases, from its raw report and marker alone: unpublished-1 to unpublished-n in the byte
// order of the real names, scores and gaps kept, the dimensions the cases had at the run, and the bare runtime's overall score
// (the mean of each case's aggregates.scoreWithout, as overallScore is the mean of each case's aggregates.score). Called only
// after unpublishedRunProblems found nothing, so every number it reads is there.
function unpublishedRecord(raw, run) {
  const dimension = new Map(run.cases.map(c => [c.name, c.dimension]));
  const number = new Map(run.cases.map(c => c.name).sort(byteOrder).map((name, i) => [name, i + 1]));
  const cases = raw.cases.map(c => ({ n: number.get(c.name), score: c.aggregates.score, delta: c.aggregates.delta })).sort((a, b) => a.n - b.n).map(c => ({ name: `unpublished-${c.n}`, score: c.score, delta: c.delta }));
  return {
    schema: 'buildguild.evidence.v1', id: `${run.date}-${run.runner}-${Math.random().toString(36).slice(2, 8)}${run.idSuffix}`,
    build: run.build, buildVersion: run.buildVersion, archiveSha256: run.archiveSha256, trial: run.trial, trialVersion: run.trialVersion, hiddenSlice: true,
    date: run.date, runner: run.runner, role: 'guild', gist: null,
    environment: run.environment,
    results: { overallScore: raw.aggregates.overallScore, casesPassed: raw.aggregates.casesPassed, casesTotal: raw.aggregates.casesTotal, meanDelta: raw.aggregates.meanDelta, dimensions: dimensionsOf(raw, name => dimension.get(name) || null), partial: false,
      bareOverallScore: meanOf(raw.cases.map(c => c.aggregates.scoreWithout)), cases },
    unpublishedCases: { count: run.count, sha256: run.sha256 },
    cost: typeof raw.costUsd === 'number' ? { usd: Number(raw.costUsd.toFixed(4)) } : null,
    durationSeconds: raw.durationSeconds ?? null,
  };
}

async function test(slug) {
  if (flag('unpublished') !== undefined) return testUnpublished(slug);
  if (!slug) die('usage: buildguild test <slug|path> --model <id> [--trial slug|path] [--max-cost-usd 5] [--runs n] [-j n] [--rep k] [--out evidence.json]');
  const model = modelId(); // first, so a run without a model downloads, resets and spends nothing
  // --rep k numbers one of several runs of the same build on the same trial: the evidence id ends in -rep<k>, and so does
  // the default file name. Without it every id and name is as it always was.
  const repFlag = flag('rep');
  if (repFlag !== undefined && !(typeof repFlag === 'string' && /^[1-9]\d*$/.test(repFlag))) die('--rep needs a whole number of at least 1; nothing was run');
  const repSuffix = repFlag === undefined ? '' : `-rep${repFlag}`;
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
  const modules = await modulePins(bundleDir);
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
  const ev = wrap(rawPath, { build: !existsSync(slug) ? slug : JSON.parse(readFileSync(join(bundleDir, 'buildguild.json'), 'utf8')).slug, buildVersion: meta.version, trialRecord, local: !!local, sha256: meta.sha256, role: flag('role', 'author'), runner, modules, idSuffix: repSuffix });
  const outPath = resolve(String(flag('out', `${local ? 'local-run' : 'evidence'}${repSuffix}.json`)));
  writeFileSync(outPath, JSON.stringify(ev, null, 2) + '\n');
  const result = `  overall ${Math.round(ev.results.overallScore * 100)}%${typeof ev.results.meanDelta === 'number' ? `, ${vsBare(ev.results.meanDelta)}` : ''}, ${ev.results.casesPassed}/${ev.results.casesTotal} cases${ev.cost ? `, est. $${ev.cost.usd}` : ''}${ev.results.partial ? ' (PARTIAL: cost ceiling hit)' : ''}`;
  if (local) out(`\nlocal run: ${outPath}\n${result}\nnot evidence: a run on a local trial folder is for its author; only a run on a published trial can be submitted.`);
  else out(`\nevidence: ${outPath}\n${result}\nnext: node cli/buildguild.mjs submit ${relative(process.cwd(), outPath) || 'evidence.json'}`);
  process.exit(r.status === 2 ? 2 : 0);
}


// Every check of test --unpublished that needs nothing to run, in one place, in this order: the flags and their values, the
// role, the published trial's slug, the build's slug, the folder (argument, roster, case names, structure, names under cases/,
// then on the cases' bytes the public trial's form and the checksum), the three outputs (each new, in an existing folder this
// user can create files in, outside the unpublished folder, no two one path), the published trial and its case names, the
// published build and its archive record, and Claude Code. Only when all pass may anything be run, created or written, or the
// archive downloaded.
async function unpublishedPreflight(slug) {
  onlyFlags('test');
  const model = flag('model') ?? process.env.ANTHROPIC_MODEL;
  if (typeof model !== 'string' || !model) refuse('model', 'test needs --model <id>, the model the agent runs on (the hosted season trial runs claude-sonnet-5-5); ANTHROPIC_MODEL may stand in for the flag. Nothing was run.');
  const rep = flag('rep');
  if (rep !== undefined && !/^[1-9]\d*$/.test(rep)) refuse('rep', '--rep needs a whole number of at least 1; nothing was run');
  const runner = flag('runner');
  if (typeof runner !== 'string' || !/^[A-Za-z0-9-]+$/.test(runner)) refuse('runner', `with --unpublished, --runner names the GitHub login the record credits (letters, digits and hyphens)${runner === undefined ? '' : `, not ${JSON.stringify(runner)}`}; nothing was run`);
  const ceiling = flag('max-cost-usd');
  if (ceiling !== undefined && !(Number(ceiling) > 0 && Number.isFinite(Number(ceiling)))) refuse('flag-value', `--max-cost-usd needs a positive number of USD, not ${JSON.stringify(ceiling)}; nothing was run`);
  const concurrency = flag('j');
  if (concurrency !== undefined && !/^[1-8]$/.test(concurrency)) refuse('flag-value', `-j needs a whole number from 1 to 8, as the runner takes, not ${JSON.stringify(concurrency)}; nothing was run`);
  for (const name of ['raw-out', 'work-dir']) if (flag(name) === undefined) refuse('output-missing', `with --unpublished, --${name} is required, so the private outputs are where you choose; nothing was run`);
  guildRoleOnly();
  const publishedSlug = publishedSlugFor(flag('trial'));
  if (!slug) refuse('build-missing', 'usage: buildguild test <published-build> --trial <published-slug> --unpublished <trial-folder> --model <id> --runner <login> --raw-out <new-file> --work-dir <new-folder>; nothing was run');
  if (existsSync(slug)) refuse('build-folder', `${slug} is a path here; with --unpublished the build is a published build, named by its slug, so its record is about an archive whose SHA-256 is checked. Nothing was run.`);
  if (!SLUG.test(slug)) refuse('build-slug', `build must be a kebab-case slug, got ${JSON.stringify(slug)}; nothing was run`);
  const repSuffix = rep === undefined ? '' : `-rep${rep}`;
  const folder = unpublishedFolder(flag('unpublished'));
  const outPath = newOutput('--out', flag('out', `evidence-unpublished${repSuffix}.json`), folder.root);
  const rawOut = newOutput('--raw-out', flag('raw-out'), folder.root);
  const workDir = newOutput('--work-dir', flag('work-dir'), folder.root);
  if (basename(workDir).toLowerCase() === EVAL_FOLDER) refuse('work-dir-name', `--work-dir ${workDir} is named like the folder the cases go to, ${EVAL_FOLDER}, so the runner could take the run folder itself for that folder; name it otherwise. Nothing was run.`);
  const outputs = [['--out', outPath], ['--raw-out', rawOut], ['--work-dir', workDir]];
  // Paths that differ only in case or in Unicode normalization are one path on a file system that ignores them, as macOS's does.
  const pathKey = p => p.normalize('NFC').toLowerCase();
  for (const [name, p] of outputs) for (const [other, q] of outputs) if (name < other && pathKey(p) === pathKey(q)) refuse('output-same', `${name} and ${other} are the same path${p === q ? `, ${p}` : ` where case is ignored (${p} and ${q})`}; each output needs its own. Nothing was run.`);
  const published = await lookUp(`/trials/${publishedSlug}.json`, 'trial-lookup', `the published trial ${publishedSlug}`);
  refuseSharedNames(folder, published);
  const build = await lookUp(`/builds/${slug}.json`, 'build-lookup', `the published build ${slug}`);
  if (typeof build?.archive?.url !== 'string' || !SHA256_HEX.test(String(build.archive.sha256)) || typeof build.version !== 'string') refuse('build-archive', `${slug} has no archive with a SHA-256 to run; nothing was run`);
  const claude = which('claude');
  if (!claude) refuse('claude', 'claude is not installed; install Claude Code 2.1.269 or later. Nothing was run.');
  return { model, runner, repSuffix, published, build, folder, claude, outPath, rawOut, workDir };
}
// The plugin the run loads, from the build's own manifest in the run folder. The runner is told --eval-dir unpublished-cases, and an archive
// whose manifest names an eval folder of its own (experimental.evals, or a top-level evals, which the runner ignores) is refused
// before the runner starts, as is one whose manifest does not name this build with a version. The check that the build loaded
// compares the report with this name, version and folder.
function buildPlugin(workDir, slug) {
  const stop = why => die(`${why}; the runner was not started, and no record was written`);
  const read = path => { try { const m = JSON.parse(readFileSync(path, 'utf8')); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; } catch { return null; } };
  const main = join(workDir, '.claude-plugin', 'plugin.json');
  const manifest = existsSync(main) ? read(main) : null;
  if (manifest === null) stop(`the build's archive has no .claude-plugin/plugin.json that is a JSON object`);
  for (const path of [main, join(workDir, 'plugin.json')].filter(path => existsSync(path))) {
    const m = read(path);
    if (m === null) stop(`the build's archive holds ${relative(workDir, path)}, which is not a JSON object`);
    if ('evals' in m || (m.experimental !== null && typeof m.experimental === 'object' && 'evals' in m.experimental)) stop(`the build's plugin manifest ${relative(workDir, path)} names an eval folder of its own; in this mode the runner is pointed at the cases this run writes to ${EVAL_FOLDER}/`);
  }
  if (manifest.name !== slug || !isText(manifest.version)) stop(`the build's plugin manifest names ${JSON.stringify(manifest.name ?? null)} version ${JSON.stringify(manifest.version ?? null)}, not the build ${slug} with a version`);
  return { name: manifest.name, version: manifest.version, path: workDir };
}
// test --unpublished: the preflight, then the folder's fixtures, then the run in a new run folder on the build's verified archive,
// then a record only for a complete run whose report this run wrote.
async function testUnpublished(slug) {
  const p = await unpublishedPreflight(slug);
  // The folder gets every check `check` runs, its fixtures included. The cases' bytes were read in the preflight, and those
  // bytes, the ones the checksum is taken from, are the ones the run is given, whatever a fixture leaves behind.
  checkFolder(p.folder.root, 'trial');
  mkdirSync(p.workDir);
  const zip = await fetchBytes(p.build.archive.url);
  const archiveSha256 = createHash('sha256').update(zip).digest('hex');
  if (archiveSha256 !== p.build.archive.sha256) die('SHA-256 mismatch');
  // The archive is unpacked into the new run folder without its own evals/ or unpublished-cases/, the latter being where the
  // cases go, and without any report file, so the report read after the run is the one this run wrote.
  for (const e of unzip(zip)) {
    const rel = stripTop(e.name);
    if (rel === 'buildguild-raw.json' || [EVAL_FOLDER, 'evals'].some(folder => rel === folder || rel.startsWith(`${folder}/`))) continue;
    const target = safeJoin(p.workDir, rel); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, e.data, { mode: modeFor(rel) });
  }
  // An entry named otherwise that still lands there (through a "." in its path, or a name that differs only in case on a file
  // system that ignores case) is found by the file system's own lookup, and the runner is not started.
  for (const name of ['buildguild-raw.json', EVAL_FOLDER, 'evals']) if (existsSync(join(p.workDir, name))) die(`the build's archive holds an entry that lands on ${name} in the run folder ${p.workDir}, which the archive may not fill (${name === 'buildguild-raw.json' ? 'only this run\'s report goes there' : name === EVAL_FOLDER ? 'only this run\'s cases go there' : 'the runner\'s default eval folder'}); the runner was not started, and no record was written`);
  const plugin = buildPlugin(p.workDir, slug);
  const modules = await modulePins(p.workDir);
  const t = p.published;
  out(`unpublished cases of ${t.name} v${t.version}: ${p.folder.count} from ${p.folder.root}\n  sha256 ${p.folder.sha256}`);
  writeTree(join(p.workDir, EVAL_FOLDER), p.folder.files);
  const rawPath = join(p.workDir, 'buildguild-raw.json');
  // The runner arguments of any other run, and --eval-dir unpublished-cases, a folder the loader opens exactly for a run folder
  // with an ordinary name (see EVAL_FOLDER), not a folder the build's manifest names; --runs is refused in this mode, so each
  // case runs as often as it declares.
  const argv = ['plugin', 'eval', '.', '--eval-dir', EVAL_FOLDER, '--scaffold', '--allow-tools', 'Bash', 'Write', 'Edit', '--json', 'buildguild-raw.json', '--no-publish', '--trust-plugin', '--ablation', 'with-without', '--max-cost-usd', String(flag('max-cost-usd', '5')), '--threshold', '0'];
  if (flag('j')) argv.push('-j', String(flag('j')));
  argv.push('--model', p.model);
  if (flag('keep-temp')) argv.push('--keep-temp');
  out(`running: claude ${argv.join(' ')}\n  in ${p.workDir}\n  this runs the trial's fixture scripts and the build's hooks on your machine, as you.`);
  // The raw report and the run folder hold the unpublished cases' names and prompts, so they are named once, before the run.
  console.error(`warning: private files. The run folder ${p.workDir}, its raw report ${rawPath}, the copy ${p.rawOut}${flag('keep-temp') ? ' and the runner folders --keep-temp keeps' : ''} hold the unpublished cases' names and prompts. Do not commit, upload or paste them anywhere. Only the record this command writes may be shared.`);
  const r = spawnSync(p.claude, argv, { cwd: p.workDir, stdio: 'inherit' });
  if (!existsSync(rawPath)) die(`the runner wrote no report (exit ${r.status ?? r.signal}), so no record was written`, 2);
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  raw.trialSource = 'unpublished';
  raw.unpublishedRun = { trial: t.slug, trialVersion: t.version, count: p.folder.count, sha256: p.folder.sha256,
    cases: p.folder.record.cases.map(c => ({ name: c.name, dimension: c.dimension, graders: p.folder.graders[c.name] })),
    build: slug, buildVersion: p.build.version, archiveSha256, plugin, runner: p.runner, date: new Date().toISOString().slice(0, 10), idSuffix: p.repSuffix,
    environment: { ...fingerprint(), claudeCode: raw.claudeVersion || fingerprint().claudeCode, modules }, runnerExit: r.status ?? `signal ${r.signal}` };
  // The report is kept, marked, whatever comes next: a plain wrap refuses it, and it shows what happened. The run folder's copy
  // is this run's own file; --raw-out is created new.
  writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');
  createNew('--raw-out', p.rawOut, JSON.stringify(raw, null, 2) + '\n', `the marked raw report stays in the run folder at ${rawPath}, and no record was written`);
  if (raw.partialReason === 'auth_failed') die('the eval runner could not authenticate its agent runs ("Not logged in"). It runs `claude -p` in an isolated home, so run this from a terminal where `claude` is logged in, or set ANTHROPIC_API_KEY. No evidence file was written.', 2);
  const problems = unpublishedRunProblems(raw, raw.unpublishedRun);
  if (problems.length) die(`no record was written: the run on the unpublished cases is not complete.\n  - ${problems.join('\n  - ')}\nThe raw report ${rawPath} and its copy ${p.rawOut} are kept, marked, to work out what happened; they hold the cases' names and prompts, so keep them private.`, 2);
  gradedErrorNote(raw);
  const ev = unpublishedRecord(raw, raw.unpublishedRun);
  createNew('--out', p.outPath, JSON.stringify(ev, null, 2) + '\n', `no record was written. The raw report ${rawPath} and its copy ${p.rawOut} are kept, and wrap --unpublished can write the record to a new path`);
  out(`\nhidden-slice record: ${p.outPath}\n  overall ${Math.round(ev.results.overallScore * 100)}%, ${vsBare(ev.results.meanDelta)}, ${ev.results.casesPassed}/${ev.results.casesTotal} cases${ev.cost ? `, est. $${ev.cost.usd}` : ''}; bare runtime ${Math.round(ev.results.bareOverallScore * 100)}%\nIt names the cases only as unpublished-1 to unpublished-${p.folder.count}. A maintainer adds it to Build by pull request; submit refuses it.`);
  process.exit(0);
}

// wrap --unpublished: rebuilds the record `test --unpublished` wrote from its saved raw report, with no second run, into --out,
// a new file. Every fact of the record comes from the report and its marker; a flag that names a different build, version,
// archive, runner or model is refused, never written in. The report must be one such a run marked, on the published trial's
// current version; the folder must still hold the same cases (it gets the checks that run nothing; wrap runs no fixture); and
// the run must pass the same checks as in test, the runner's exit status among them. A dimension edited in the folder's
// trial.json since the run is reported and not used.
async function wrapUnpublished(rawPath) {
  onlyFlags('wrap');
  guildRoleOnly();
  const publishedSlug = publishedSlugFor(flag('trial'));
  if (flag('out') === undefined) refuse('output-missing', 'wrap --unpublished needs --out <new-file> for the record; nothing was written');
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  const run = raw.unpublishedRun;
  if (raw.trialSource !== 'unpublished' || !validMarker(run)) die(`${rawPath} is not the report of a run with --unpublished, so it cannot become a hidden-slice record`);
  if (run.trial !== publishedSlug) die(`${rawPath} is a run on unpublished cases of ${run.trial}, not of ${publishedSlug}`);
  const given = { build: flag('build'), 'build-version': flag('build-version'), sha256: flag('sha256'), runner: flag('runner'), model: modelId() };
  const ran = { build: run.build, 'build-version': run.buildVersion, sha256: run.archiveSha256, runner: run.runner, model: run.environment.model };
  for (const [name, value] of Object.entries(given)) if (value !== undefined && value !== ran[name]) die(`--${name} ${value} is not the run's ${ran[name]}; wrap --unpublished writes the record of the run in ${rawPath}, so no record was written`);
  const folder = unpublishedFolder(flag('unpublished'));
  const outPath = newOutput('--out', flag('out'), folder.root);
  const published = await lookUp(`/trials/${publishedSlug}.json`, 'trial-lookup', `the published trial ${publishedSlug}`);
  if (published.version !== run.trialVersion) die(`${rawPath} ran against ${publishedSlug} v${run.trialVersion}, and the published trial is now v${published.version}; its record would count on the wrong version, so none was written`);
  refuseSharedNames(folder, published);
  if (folder.count !== run.count || folder.sha256 !== run.sha256) die(`${folder.root} no longer holds the cases that run used (it has ${folder.count} with sha256 ${folder.sha256}; the run had ${run.count} with sha256 ${run.sha256}); no record was written`);
  const number = new Map(run.cases.map(c => c.name).sort(byteOrder).map((name, i) => [name, i + 1]));
  for (const c of run.cases) {
    const now = folder.record.cases.find(x => x.name === c.name)?.dimension;
    if (now !== c.dimension) console.error(`note: ${folder.root}/trial.json now gives unpublished-${number.get(c.name)} the dimension ${now}; the record keeps ${c.dimension}, its dimension at the run`);
  }
  const problems = unpublishedRunProblems(raw, run);
  if (problems.length) die(`no record was written: ${rawPath} is not the report of a complete run on the unpublished cases.\n  - ${problems.join('\n  - ')}`);
  gradedErrorNote(raw);
  createNew('--out', outPath, JSON.stringify(unpublishedRecord(raw, run), null, 2) + '\n', 'no record was written');
  out(`hidden-slice record: ${outPath}`);
}

// What submit tells the runner about the role: the record's role is only a hint, and the guild decides it from the account.
const roleDecided = login => `The guild decides at acceptance whether this record is the build author's own run or a reproduction, from the GitHub account that publishes it ("${login}"); the role below is only a hint.`;

async function submit(path) {
  if (!path) die('usage: buildguild submit <evidence.json> [--yes]');
  const ev = JSON.parse(readFileSync(path, 'utf8'));
  if (ev.schema !== 'buildguild.evidence.v1') die('not a buildguild.evidence.v1 file');
  if (ev.trialSource === 'local') die(`${path} is a run on a local trial folder, which is for its author and is not evidence; only a run on a published trial can be submitted. Nothing was sent.`);
  if (ev.hiddenSlice !== undefined || ev.unpublishedCases !== undefined) die(`${path} is a run on a trial's unpublished cases (a hidden-slice record). A maintainer adds it to Build by pull request; it is never sent as a Gist. Nothing was sent.`);
  const gh = which('gh'); if (!gh) die('gh (GitHub CLI) is required to publish the evidence as a Gist from your account');
  const login = version('gh', ['api', 'user', '--jq', '.login']); if (!login) die('gh is not logged in (gh auth login)');
  ev.runner = login;
  const summary = { schema: ev.schema, build: ev.build, buildVersion: ev.buildVersion, trial: ev.trial, trialVersion: ev.trialVersion, runner: ev.runner, role: ev.role, results: ev.results, environment: ev.environment, cost: ev.cost, date: ev.date };
  out(`About to publish a PUBLIC Gist from GitHub account "${login}" with this evidence file, then send this summary to ${ORIGIN}/api/evidence.`);
  out(`${roleDecided(login)}\n`);
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
  if (slug.length < 3 || slug.length > 48) die('trial name must be a kebab-case slug, 3 to 48 characters');
  const root = resolve(slug);
  if (existsSync(root)) die(`${root} already exists`);
  // Trial authoring must work offline, even when gh is installed and signed in.
  const author = flag('author', process.env.USER || 'your-login');
  if (typeof author !== 'string' || !author.trim()) die('--author needs a nonempty name');
  const license = flag('license', 'Apache-2.0');
  if (!LICENSES.includes(license)) die(`license must be one of ${LICENSES.join(', ')}`);
  const template = flag('template', 'scoped-config-change');
  const files = trialTemplateFiles({ slug, author: author.trim(), license, template });
  mkdirSync(root, { mode: 0o700 }); // Refuse a racing creation instead of overwriting it.
  writeTree(root, files);
  out(`new trial at ${root} (template: ${template})\nnext: node cli/buildguild.mjs check-examples ./${slug}\nThis checks synthetic examples offline; it does not run a model or prove model quality.`);
}

function checkTrialExamples(target) {
  if (!target) die('usage: buildguild check-examples <trial-folder>');
  const result = checkExamples(target);
  out(`${result.cases} case(s), ${result.examples} reference examples, ${result.assertions}/${result.plannedAssertions} grader assertions checked`);
  for (const failure of result.failures) console.error(`  - ${failure}`);
  out(result.ok ? 'Reference examples passed. No fixtures, commands or models were run.' : 'Reference example checks failed. No model evidence was produced.');
  process.exitCode = result.ok ? 0 : 1;
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

function checkTrial(root, problems, options = {}) {
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
        else if (!options.structuralOnly && !flag('no-fixtures')) {
          const tmp = mkdtempSync(join(tmpdir(), 'bg-fixture-'));
          const r = spawnSync('bash', ['-e', fpath], { cwd: tmp, encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME: tmp } });
          if (r.status !== 0) problems.push(`cases/${c}/${fixture}: exited ${r.status}${r.stderr ? ': ' + r.stderr.trim().split('\n').pop() : ''}`);
          rmSync(tmp, { recursive: true, force: true });
        }
      }
    }
  }
}

function checkBuild(root, problems, options = {}) {
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
  if (!options.ignoreEvals && existsSync(join(root, 'evals'))) for (const c of readdirSync(join(root, 'evals')).filter(n => n !== 'results')) { const gdir = join(root, 'evals', c, 'graders'); if (existsSync(gdir)) for (const g of readdirSync(gdir)) checkGrader(readFileSync(join(gdir, g), 'utf8'), `evals/${c}/graders/${g}`, problems); }
  const claude = options.structuralOnly ? null : which('claude');
  if (claude && !options.structuralOnly && !flag('no-validator')) {
    const r = spawnSync(claude, ['plugin', 'validate', root, '--strict'], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) problems.push(`claude plugin validate --strict failed:\n    ${(r.stdout + r.stderr).trim().split('\n').slice(-6).join('\n    ')}`);
  } else if (!claude && !options.structuralOnly) out('note: claude is not installed, skipped claude plugin validate');
}

// Every check `check` runs on a build or trial folder; any problem is listed and exits 1. A --trial folder gets it too.
function checkFolder(root, kind, options = {}) {
  const problems = folderProblems(root, kind, options);
  if (problems.length) { console.error(`${kind} ${root}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`); process.exit(1); }
}
function folderProblems(root, kind, options = {}) {
  const problems = [];
  if (!existsSync(join(root, 'README.md'))) problems.push('README.md is missing');
  else if (words(readFileSync(join(root, 'README.md'), 'utf8')) < 40) problems.push('README.md needs at least forty words');
  if (!existsSync(join(root, 'LICENSE'))) problems.push('LICENSE is missing');
  for (const n of ['.env', '.env.local', 'id_rsa', 'credentials.json']) if (existsSync(join(root, n))) problems.push(`${n} must not ship in a submission`);
  if (kind === 'trial') checkTrial(root, problems, options); else checkBuild(root, problems, options);
  return problems;
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
Run from a checkout of https://github.com/Guild-Build/Build; the buildguild npm package is not published yet, so do not run it with npx.

  node cli/buildguild.mjs list          builds this season with tiers
  node cli/buildguild.mjs show <slug>   one build's modules, profiles, evidence
  node cli/buildguild.mjs add <slug> [--scope project|user] [--target claude|codex|all]
                                        download, verify SHA-256, unpack, record in .buildguild/lock.json
  node cli/buildguild.mjs remove <slug> reverse an add
  node cli/buildguild.mjs doctor        which runtimes are installed, what the lock says
  node cli/buildguild.mjs prepare <current-folder> <candidate-folder> --trial <folder> --model <id> --max-cost-usd <total> --out <new-directory> [--runs 3]
                                        freeze a private comparison and write review.html; offline, no model or fixture execution
  node cli/buildguild.mjs compare --plan <plan.json> --plan-sha256 <reviewed-sha256> --out <new-directory>
                                        execute the reviewed preparation after verifying its settings and frozen input hashes
  node cli/buildguild.mjs compare <current-folder> <candidate-folder> --trial <folder> --model <id> --max-cost-usd <total> --out <new-directory> [--runs 3]
                                        private local comparison; writes comparison.json and report.html, never submits
  node cli/buildguild.mjs new build <name> [--author login] [--license id]
                                        scaffold a build (plugin + buildguild.json)
  node cli/buildguild.mjs new trial <name> [--template scoped-config-change|blocked-handoff] [--author name] [--license id]
                                        offline task template with tested reference examples; default scoped-config-change
  node cli/buildguild.mjs check-examples <trial-folder>
                                        test actual deterministic graders against synthetic good/bad/boundary examples; no model or fixture calls
  node cli/buildguild.mjs check [path]  manifest, skills, agents, hooks and the plugin validator for a build; manifest, cases,
                                        grader front matter and fixture scripts for a trial. Run this before anything else
  node cli/buildguild.mjs publish [path] [--repo url] [--github login] [--email a] [--summary s] [--yes]
                                        check, show the submission, ask for the consents, then post it to the guild
  node cli/buildguild.mjs trial [slug]  download a trial's cases into .buildguild/trials/
  node cli/buildguild.mjs test <slug|path> --model <id> [--trial slug|path] [--max-cost-usd 5] [--runs n] [-j n] [--rep k] [--out evidence.json] [--raw-out raw.json] [--work-dir dir]
                                        run a published trial (default guild-smoke-v1) with claude plugin eval (Claude Code 2.1.269+) in a temp copy,
                                        write an evidence file. A trial folder of your own is checked first; its run goes to local-run.json, not evidence.
                                        environment.modules records each module ref and its GitHub commit SHA at run time, or null when unavailable.
                                        --model names the model it runs on (the hosted season trial: claude-sonnet-5-5); ANTHROPIC_MODEL may stand in
                                        --work-dir is deleted first, so it may not be /, home, the current directory or above, or in or around the build or trial folder
                                        --rep k marks run k of several of the same build on the same trial: the evidence id and the default file name end in -rep<k>
                                        --role author (the default) or assayer is only a hint the record carries: the guild decides at acceptance
                                        whether a run is the author's own or a reproduction, from the GitHub account that publishes it
  node cli/buildguild.mjs test <published-build> --trial <published-slug> --unpublished <trial-folder> --model <id> --runner <login>
                                        --raw-out <new-file> --work-dir <new-folder> [--out <new-file>] [--role guild] [--max-cost-usd 5] [-j n] [--rep k] [--keep-temp]
                                        a guild maintainer's run of a private folder of cases, in the public trial's form, as the unpublished part
                                        (hidden slice) of a published trial, with a published build only; any other flag (--runs among them) is
                                        refused. The preflight refuses everything it checks (listed in cli/README.md) before the build's archive
                                        is downloaded or anything is run or written; what the runner's loader accepts is the runner's to decide,
                                        so rehearse first against a stand-in for the model. It creates its outputs (new files, a new run folder)
                                        and overwrites and deletes nothing; the runner is told --eval-dir unpublished-cases; a record is written
                                        only for a complete run of exactly the folder's cases, with the build loaded, whose report this run wrote,
                                        and the record (default evidence-unpublished.json) is a guild record with hiddenSlice true, its cases
                                        named unpublished-1 to -n, unpublishedCases {count, sha256} and results.bareOverallScore. The run folder
                                        and raw report hold the cases' names and prompts: never commit, upload or paste them
  node cli/buildguild.mjs unpublished <trial-folder>
                                        print the count and checksum of a folder's unpublished cases, running nothing, so both can be published first
  node cli/buildguild.mjs wrap <aggregate.json> --build <slug> --trial <slug|path> --model <id> [--build-version v] [--runner login]
                                        convert a raw eval report into buildguild.evidence.v1 naming the model it ran on (from a trial folder: a local record)
                                        with --unpublished <folder> --trial <published-slug> --out <new-file>: rebuild the record test --unpublished
                                        wrote, every fact from its raw report
  node cli/buildguild.mjs submit <evidence.json> [--yes]
                                        publish as a public Gist from your GitHub account and send the summary; refuses a local run and a hidden-slice record.
                                        The guild decides at acceptance whether the record is the author's own run or a reproduction, from that account
`;

(async () => {
  if (['prepare', 'compare', 'test', 'wrap'].includes(cmd) && flag('effort') !== undefined) die('--effort is not supported by claude plugin eval; no run was started or evidence written');
  if (cmd === 'wrap') modelId(); // its case fetches the trial record first; a missing model is refused before any request
  switch (cmd) {
    case 'prepare': return prepareComparison(args.slice(1), { checkFolder });
    case 'compare': return compare(args.slice(1), { checkFolder });
    case 'list': return list();
    case 'show': return show(positional[0]);
    case 'add': return add(positional[0]);
    case 'remove': return remove(positional[0]);
    case 'doctor': return doctor();
    case 'new': return positional[0] === 'build' ? newBuild(positional[1]) : positional[0] === 'trial' ? newTrial(positional[1]) : die('usage: buildguild new build <name> | new trial <name>');
    case 'check-examples': return checkTrialExamples(positional[0]);
    case 'check': return check(positional[0]);
    case 'publish': return publish(positional[0]);
    case 'trial': return trial(positional[0]);
    case 'unpublished': return unpublished(positional[0]);
    case 'test': return test(positional[0]);
    case 'wrap': {
      if (flag('unpublished') !== undefined) return wrapUnpublished(positional[0]);
      // A report of a run on unpublished cases holds their names; it becomes a record only through --unpublished.
      if (JSON.parse(readFileSync(positional[0], 'utf8')).trialSource === 'unpublished') die(`${positional[0]} is the report of a run on unpublished cases; wrap it with --unpublished <the same folder> --trial <the published slug>`);
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
