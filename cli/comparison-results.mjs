import { isAbsolute, resolve } from 'node:path';

// Comparison reports are local summaries. Runner prompts, explanations and traces may
// contain customer data, so this adapter copies only the fields needed for a decision.
const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : null;
const fraction = value => nonnegative(value) !== null && value <= 1;
const versionNumber = value => typeof value === 'string' ? value.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null : null;
const addKnown = (a, b) => a === null || b === null ? null : a + b;
const names = entries => Array.isArray(entries) ? entries.map(entry => entry?.name) : [];
const uniqueNames = list => list.length > 0 && list.every(name => typeof name === 'string' && name.length > 0)
  && new Set(list).size === list.length;

function summarizeAttempt(arm, number, graderNames) {
  const attempt = { number, status: 'missing', score: null, costUsd: null, durationSeconds: null };
  if (arm == null) return attempt;
  attempt.costUsd = addKnown(nonnegative(arm.costUsd), nonnegative(arm.judgeCostUsd));
  attempt.durationSeconds = nonnegative(arm.durationSeconds);
  if (arm.error || arm.aborted) return { ...attempt, status: 'error' };

  const reportedNames = names(arm.graders);
  const complete = uniqueNames(graderNames) && uniqueNames(reportedNames)
    && reportedNames.length === graderNames.length && reportedNames.every(name => graderNames.includes(name));
  if (!complete || !fraction(arm.score)
    || arm.error !== null || arm.skippedPaidGraders !== false
    || !arm.graders.every(grade => grade.scored === true && typeof grade.passed === 'boolean')) {
    return { ...attempt, status: 'ungraded' };
  }

  // Do not use the runner's suite-level pass count. Full acceptance means every
  // grader passed.
  const accepted = arm.score === 1 && arm.graders.every(grade => grade.passed);
  return { ...attempt, score: arm.score, status: accepted ? 'accepted' : 'failed' };
}

function matchesSuite(suite, plugin, model) {
  if (!suite || !plugin || typeof model !== 'string' || suite.modelOverride !== model
    || suite.ablation !== 'none' || suite.concurrency !== 1
    || !Array.isArray(suite.plugins) || suite.plugins.length !== 1) return false;
  const [loaded] = suite.plugins;
  const samePath = value => typeof value === 'string' && isAbsolute(value) && resolve(value) === resolve(plugin.path);
  return loaded?.name === plugin.name && loaded.version === plugin.version
    && !loaded.problem && samePath(loaded.path) && samePath(suite.root);
}

export function normalizeRun(raw, { cases, runs, exitCode, runnerVersion, plugin, model }) {
  const issues = [];
  const observedVersion = versionNumber(raw?.claudeVersion);
  const supportedReport = raw?.schemaVersion === 1 && Array.isArray(raw.cases);
  const matchedVersion = observedVersion !== null && observedVersion === versionNumber(runnerVersion);
  if (!supportedReport) issues.push('Missing or unsupported runner report');
  if (!matchedVersion) issues.push('Runner version could not be matched');
  const matchedSuite = supportedReport && matchesSuite(raw.suite, plugin, model);
  if (supportedReport && !matchedSuite) issues.push('Runner suite differs from the planned plugin or settings');
  if (raw?.partial !== false) issues.push('Runner did not confirm a complete run');

  const observed = new Map();
  const expected = new Set(cases.map(entry => entry.name));
  if (supportedReport) {
    for (const row of raw.cases) {
      if (!expected.has(row?.name)) {
        issues.push('Runner returned a case outside the trial plan');
        continue;
      }
      if (observed.has(row.name)) {
        issues.push(`Runner returned duplicate results for ${row.name}`);
        observed.set(row.name, null);
        continue;
      }
      observed.set(row.name, row);
    }
  }

  const counts = { planned: cases.length * runs, completed: 0, graded: 0, accepted: 0, failed: 0, missing: 0, errors: 0, ungraded: 0 };
  const planned = cases.map(({ name, dimension, graderNames: plannedGraders }) => {
    const row = observed.get(name);
    const arms = row?.arms?.with;
    const hasUnexpectedArms = Array.isArray(row?.arms?.without) && row.arms.without.length > 0;
    if (row && (!Array.isArray(arms) || arms.length > runs || row.runsPerCase !== runs || hasUnexpectedArms)) {
      issues.push(`Runner attempt layout differs from plan for ${name}`);
    }
    const graderNames = names(row?.graders);
    const matchesPlan = plannedGraders === undefined || (
      uniqueNames(plannedGraders) && graderNames.length === plannedGraders.length
      && plannedGraders.every(grader => graderNames.includes(grader))
    );
    if (row && !matchesPlan) issues.push(`Runner graders differ from plan for ${name}`);

    const attempts = Array.from({ length: runs }, (_, index) =>
      summarizeAttempt(Array.isArray(arms) ? arms[index] : null, index + 1, matchesPlan && matchedSuite ? graderNames : []));
    let accepted = 0;
    for (const attempt of attempts) {
      if (attempt.status !== 'missing' && attempt.status !== 'error') counts.completed++;
      if (attempt.status === 'accepted' || attempt.status === 'failed') counts.graded++;
      if (attempt.status === 'accepted') accepted++;
      counts[attempt.status === 'error' ? 'errors' : attempt.status]++;
    }
    return { name, dimension, accepted, attempts };
  });
  if (counts.missing || counts.errors || counts.ungraded) issues.push('Some planned attempts lack a valid grade');
  // Claude uses exit 1 for a completed run below the configured threshold.
  // An exit 1 with no failed acceptance is unexplained and cannot be compared.
  if (exitCode !== 0 && !(exitCode === 1 && counts.failed > 0)) issues.push('Runner did not finish successfully');
  const canReadMetrics = supportedReport && matchedVersion;
  const costUsd = canReadMetrics ? nonnegative(raw.costUsd) : null;
  const durationSeconds = canReadMetrics ? nonnegative(raw.durationSeconds) : null;
  if (costUsd === null) issues.push('Runner did not report total cost');
  if (durationSeconds === null) issues.push('Runner did not report duration');
  return {
    runnerVersion: observedVersion,
    exitCode,
    partial: raw?.partial !== false,
    costUsd,
    durationSeconds,
    costPerAcceptedUsd: costUsd === null || counts.accepted === 0 ? null : costUsd / counts.accepted,
    counts,
    acceptanceRate: counts.planned ? counts.accepted / counts.planned : null,
    issues: [...new Set(issues)],
    complete: issues.length === 0 && counts.planned > 0,
    cases: planned,
  };
}

export function createComparison({ trial, settings, incumbent, candidate, rerun }) {
  const current = incumbent.result;
  const proposed = candidate.result;
  const complete = current.complete && proposed.complete && settings.runs >= 2;
  const caseDeltas = current.cases.map((row, index) => ({
    name: row.name,
    dimension: row.dimension,
    acceptanceDelta: complete ? (proposed.cases[index].accepted - row.accepted) / settings.runs : null,
  }));
  return {
    schema: 'buildguild.comparison.v1',
    visibility: 'private',
    status: complete ? 'complete' : 'inconclusive',
    trial,
    settings,
    incumbent,
    candidate,
    rerun,
    acceptanceDelta: complete ? proposed.acceptanceRate - current.acceptanceRate : null,
    caseDeltas,
    costUsd: addKnown(current.costUsd, proposed.costUsd),
  };
}

const escapeHtml = value => String(value ?? 'Unknown').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const percent = value => value === null ? 'Unknown' : `${(100 * value).toFixed(1)}%`;
const usd = value => value === null ? 'Unknown' : `$${value.toFixed(4)}`;
const seconds = value => value === null ? 'Unknown' : `${value.toFixed(1)} s`;
const change = value => value === null ? '—' : `${value > 0 ? '+' : ''}${(100 * value).toFixed(1)} pp`;

export function renderComparison(report) {
  const { trial, settings, incumbent, candidate } = report;
  const current = incumbent.result;
  const proposed = candidate.result;
  const countLabels = {
    planned: 'Planned attempts', completed: 'Completed without runner error', graded: 'Graded',
    accepted: 'Accepted', failed: 'Failed acceptance', missing: 'Missing', errors: 'Runner errors', ungraded: 'Ungraded',
  };
  const row = (label, a, b) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`;
  const rows = Object.entries(countLabels).map(([key, label]) => row(label, current.counts[key], proposed.counts[key])).join('');
  const cases = current.cases.map((item, index) => {
    const next = proposed.cases[index];
    const details = result => result.attempts.map(attempt =>
      `<li>Attempt ${attempt.number} · ${attempt.status} · score ${percent(attempt.score)} · ${usd(attempt.costUsd)} · ${seconds(attempt.durationSeconds)}</li>`).join('');
    return `<section class="case"><h3>${escapeHtml(item.name)}</h3>
<p>${escapeHtml(item.dimension)} · Change ${change(report.caseDeltas[index].acceptanceDelta)}</p>
<details><summary>Current accepted ${item.accepted}/${settings.runs} · Candidate accepted ${next.accepted}/${settings.runs}</summary>
<h4>Current</h4><ul>${details(item)}</ul><h4>Candidate</h4><ul>${details(next)}</ul></details></section>`;
  }).join('');
  const issues = [current, proposed].flatMap((run, index) => run.issues.map(issue =>
    `<li>${index === 0 ? 'Current' : 'Candidate'} · ${escapeHtml(issue)}</li>`));
  if (settings.runs < 2) issues.push('<li>Use at least two attempts per case to report differences.</li>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>BuildGuild private comparison</title><style>
body{margin:0;background:#f6f7fa;color:#182335;font:1rem/1.55 system-ui,sans-serif}
main{max-width:56rem;margin:auto;padding:clamp(1rem,4vw,2.5rem)}
h1,h2,h3,h4{line-height:1.2} h1{margin:.4rem 0}
section{margin:1.4rem 0} .case{border-left:3px solid #acb7c7;padding-left:1rem}
table{width:100%;border-collapse:collapse;background:white} caption{text-align:left;padding:.4rem 0}
th,td{padding:.55rem;text-align:left;vertical-align:top;border-bottom:1px solid #cfd5e0}
code,pre,th,td,dd{overflow-wrap:anywhere} pre{white-space:pre-wrap;background:#e9edf3;padding:1rem}
summary{cursor:pointer} dd{margin:0 0 .65rem}
</style></head><body><main>
<p>BuildGuild · Private trial</p><h1>Configuration comparison</h1>
<p>${escapeHtml(trial.slug)} · version ${escapeHtml(trial.version)}</p>
<p><strong>${report.status === 'complete' ? 'Complete comparison' : 'Inconclusive comparison'}</strong> · Observed acceptance change ${change(report.acceptanceDelta)}</p>
<p>Acceptance requires a full score and every grader to pass. The rate uses all planned attempts as the denominator. Changes are descriptive and may vary on rerun. Review the individual cases before deciding whether to adopt the candidate.</p>
${issues.length ? `<ul>${issues.join('')}</ul>` : ''}
<section><h2>Results</h2>
<table><caption>${escapeHtml(settings.runs)} attempts per case · Total reported cost ${usd(report.costUsd)}</caption>
<thead><tr><th scope="col">Measure</th><th scope="col">Current<br>${escapeHtml(incumbent.build.slug)}</th><th scope="col">Candidate<br>${escapeHtml(candidate.build.slug)}</th></tr></thead>
<tbody>${rows}
${row('Observed acceptance', percent(current.acceptanceRate), percent(proposed.acceptanceRate))}
${row('Reported cost', usd(current.costUsd), usd(proposed.costUsd))}
${row('Cost per accepted attempt', usd(current.costPerAcceptedUsd), usd(proposed.costPerAcceptedUsd))}
${row('Duration', seconds(current.durationSeconds), seconds(proposed.durationSeconds))}
</tbody></table></section>
<section><h2>Cases</h2>${cases}</section>
<section><h2>Run identity</h2><dl>
<dt>Model requested</dt><dd>${escapeHtml(settings.model)}</dd>
<dt>Runner reported · current / candidate</dt><dd>${escapeHtml(current.runnerVersion)} / ${escapeHtml(proposed.runnerVersion)}</dd>
<dt>Effort</dt><dd>Runner default, effective setting unreported</dd>
<dt>Current build v${escapeHtml(incumbent.build.version)} · SHA-256</dt><dd><code>${escapeHtml(incumbent.build.sha256)}</code></dd>
<dt>Candidate build v${escapeHtml(candidate.build.version)} · SHA-256</dt><dd><code>${escapeHtml(candidate.build.sha256)}</code></dd>
<dt>Trial · SHA-256</dt><dd><code>${escapeHtml(trial.sha256)}</code></dd></dl></section>
<section><h2>Rerun</h2><pre><code>${escapeHtml(report.rerun)}</code></pre>
<p>This report stays local. The configured model provider processes trial inputs during execution.</p></section>
</main></body></html>
`;
}
