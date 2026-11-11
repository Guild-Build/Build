// The plan job of the Season trial workflow (.github/workflows/trial.yml) runs this file from the repository root. It
// reads the queue or the dispatch inputs, checks every request before anyone is asked to approve it, and writes the
// matrix of runs and the summary the owner sees where they approve. planRuns is pure, so tests call it without the
// network; only main() reads the environment, fetches the published trial pages and writes the step's files.
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const QUEUE = '.github/trial-queue.json';
const FIELDS = ['build', 'trial', 'max_cost_usd', 'model', 'concurrency', 'verify_only', 'repeat'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// repeat runs the same build on the same trial up to five times, one run after another, so a gap between two builds can
// be set against how much one build's score moves from run to run.
const REPEAT = /^[1-5]$/;

// A refusal of the queue or the inputs; main prints it as a workflow error and stops the plan.
export class PlanError extends Error {}
const stop = msg => { throw new PlanError(msg); };

// The name a run's files are uploaded under, built as the upload step's `name:` builds it in trial.yml; the run step's
// evidence and raw files are this name with .json, the raw one with raw- in place of evidence-. Names are joined with
// hyphens, which slugs also hold, so two different runs can share one: build a-b on trial c and build a on trial b-c, or a
// trial whose slug ends in -rep1 next to run 1 of a repeated request. tests/trial-repeats.test.mjs checks that this rule
// and the workflow's expression agree.
export const artifactName = m => `evidence-${m.build}-${m.trial}${m.rep ? `-rep${m.rep}` : ''}`;
// A run as its job is named on the run page.
const runName = m => `${m.build} on ${m.trial}${m.rep ? `, run ${m.rep}` : ''}`;

// requests is the queue's "requests" value, or the one request the dispatch inputs make. Returns the matrix (one entry per
// run) and the summary lines. A request without repeat, or with repeat 1, gives exactly the entry it always gave; with
// repeat n it gives n entries that differ only in rep, "1" to "n", which the workflow adds to the run's file and artifact
// names and passes to `buildguild test --rep`.
export function planRuns(requests, { dispatched = false, buildExists = slug => existsSync(`bundles/${slug}/buildguild.json`) } = {}) {
  if (!Array.isArray(requests)) stop(`${QUEUE} needs a "requests" list`);
  const first = new Map();
  const uploads = new Map();
  const planned = requests.map((r, i) => {
    const where = dispatched ? 'the dispatch inputs' : `request ${i + 1} in ${QUEUE}`;
    if (typeof r !== 'object' || r === null || Array.isArray(r)) stop(`${where}: a request is an object`);
    const unknown = Object.keys(r).filter(k => !FIELDS.includes(k));
    if (unknown.length) stop(`${where}: unknown field ${unknown.join(', ')}`);
    const m = { build: String(r.build ?? ''), trial: String(r.trial ?? ''), max_cost_usd: String(r.max_cost_usd ?? 5), model: String(r.model ?? 'claude-sonnet-5-5'), concurrency: String(r.concurrency ?? 1), verify_only: String(r.verify_only ?? false) };
    if (!SLUG.test(m.build) || !buildExists(m.build)) stop(`${where}: no build at bundles/${m.build}`);
    if (!SLUG.test(m.trial)) stop(`${where}: the trial "${m.trial}" is not a slug`);
    if (!/^\d+(\.\d+)?$/.test(m.max_cost_usd) || !(Number(m.max_cost_usd) > 0)) stop(`${where}: max_cost_usd must be a positive number of US dollars`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/.test(m.model)) stop(`${where}: "${m.model}" is not a model id`);
    if (!/^[1-9]\d*$/.test(m.concurrency)) stop(`${where}: concurrency must be a whole number of at least 1`);
    if (m.verify_only !== 'true' && m.verify_only !== 'false') stop(`${where}: verify_only must be true or false`);
    // A number in the queue or text from the inputs; a list such as [2] would read as "2", so only those two count. A
    // missing repeat or null is one run, as null is the default for the other optional fields.
    const repeat = r.repeat ?? 1;
    if (!['number', 'string'].includes(typeof repeat) || !REPEAT.test(String(repeat))) stop(`${where}: repeat must be a whole number from 1 to 5`);
    // Two requests for one build on one trial would upload two artifacts of the same name; repeat asks for more runs.
    const key = `${m.build} on ${m.trial}`;
    if (first.has(key)) stop(`${where}: ${key} is already request ${first.get(key)}; ask for more runs of it with repeat instead`);
    first.set(key, i + 1);
    const runs = Number(repeat) === 1 ? [m] : Array.from({ length: Number(repeat) }, (_, k) => ({ ...m, rep: String(k + 1) }));
    // Different requests can still reach one artifact name (see artifactName). The second upload would fail after its run
    // was approved and paid for, so the plan stops first.
    for (const run of runs) {
      const name = artifactName(run);
      const earlier = uploads.get(name);
      if (earlier) stop(`${where}: ${runName(run)} would upload as ${name}, the artifact name of request ${earlier.request} (${runName(earlier.run)}); two runs in one workflow cannot share an artifact name, so queue one of them separately`);
      uploads.set(name, { request: i + 1, run });
    }
    return { m, repeat: Number(repeat), runs };
  });
  const matrix = planned.flatMap(p => p.runs);
  return { matrix, summary: summarize(planned, matrix) };
}

// The run page shows this summary where the owner approves, so each approval names what it may spend. Without repeats the
// lines are the ones the workflow has always written; with repeats the table gains a Repeats column and the total is each
// ceiling times its repeats.
function summarize(planned, matrix) {
  if (!matrix.length) return ['No requests: no trial runs and nothing waits for approval.'];
  const ceiling = matrix.filter(m => m.verify_only === 'false').reduce((sum, m) => sum + Number(m.max_cost_usd), 0);
  const total = `Ceilings total ${Math.round(ceiling * 100) / 100} USD`;
  const cost = m => m.verify_only === 'true' ? 'verify only, runs nothing' : `${m.max_cost_usd} USD`;
  if (planned.every(p => p.repeat === 1)) {
    return ['| Build | Trial | Model | Ceiling |', '|---|---|---|---|', ...matrix.map(m => `| ${m.build} | ${m.trial} | ${m.model} | ${cost(m)} |`), '', `Each run waits for the owner's approval in the trials environment. ${total}.`];
  }
  return ['| Build | Trial | Model | Ceiling per run | Repeats |', '|---|---|---|---|---|', ...planned.map(({ m, repeat }) => `| ${m.build} | ${m.trial} | ${m.model} | ${cost(m)} | ${repeat} |`), '', `Each run waits for the owner's approval in the trials environment, and a request's repeats run one after another. ${total}, each ceiling times its repeats.`];
}

async function main(env = process.env) {
  const fail = msg => { console.log(`::error::${msg}`); process.exit(1); };
  const dispatched = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  // An empty repeat input is no repeat, so a dispatch that does not send one runs once, as before.
  const requests = dispatched
    ? [{ build: env.BG_BUILD, trial: env.BG_TRIAL, max_cost_usd: env.BG_MAX_COST_USD, model: env.BG_MODEL, verify_only: env.BG_VERIFY_ONLY, repeat: env.BG_REPEAT || undefined }]
    : JSON.parse(readFileSync(QUEUE, 'utf8')).requests;
  let plan;
  try { plan = planRuns(requests, { dispatched }); } catch (err) { if (err instanceof PlanError) fail(err.message); throw err; }
  const { matrix, summary } = plan;
  // The CLI fetches the same page during the run; a page it cannot read now would fail that run after approval.
  for (const trial of new Set(matrix.filter(m => m.verify_only === 'false').map(m => m.trial))) {
    const url = `${env.BUILDGUILD_ORIGIN}/trials/${trial}.json`;
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'buildguild-cli' }, signal: AbortSignal.timeout(30000) }).catch(err => ({ ok: false, status: err.message }));
    if (!res.ok) fail(`${url} cannot be read (${res.status}); a guild run uses the published trial, so nothing was started`);
  }
  appendFileSync(env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
  console.log(`matrix=${JSON.stringify(matrix)}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) await main();
