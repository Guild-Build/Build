const escapeHtml = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const definition = (label, value) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`;

export function renderPreparation(plan, { executeCommand, planSha256 }) {
  const { builds, trial, settings, tasks, totalAttempts, allocatedMaxCostUsd } = plan;
  const buildsHtml = builds.map((build, index) => `<section class="card">
<h3>${index === 0 ? '1. Current build' : '2. Candidate build'}</h3>
<p>${escapeHtml(build.slug)} · v${escapeHtml(build.version)}</p>
<dl>${definition('Plugin', `${build.plugin.name} · v${build.plugin.version}`)}
${definition('Build snapshot SHA-256', build.sha256)}
${definition('Allocated limit', `USD ${allocatedMaxCostUsd[index]}`)}</dl>
</section>`).join('');
  const tasksHtml = tasks.map(task => {
    const entry = trial.cases.find(item => item.name === task.name);
    const graders = task.graders.map(grader => `<details>
<summary>${escapeHtml(grader.name)}</summary><pre>${escapeHtml(grader.markdown)}</pre></details>`).join('');
    const metadata = task.caseYaml == null ? '' : `<details>
<summary>Case metadata and fixture</summary><pre>${escapeHtml(task.caseYaml)}</pre></details>`;
    return `<details class="card"><summary>${escapeHtml(task.name)}${entry ? ` · ${escapeHtml(entry.dimension)}` : ''}</summary>
${metadata}<h3>Task prompt</h3><pre>${escapeHtml(task.promptMarkdown)}</pre>
<h3>Grader checks</h3>${graders}</details>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Review a private comparison · BuildGuild</title>
<style>
body{margin:0;background:#f6f7fa;color:#182335;font:1rem/1.55 system-ui,sans-serif}
main{max-width:62rem;margin:auto;padding:clamp(1rem,4vw,2.5rem)}
h1,h2,h3{line-height:1.2} h1{margin:.4rem 0} h2{margin-top:2rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:.8rem}
.card{background:white;border:1px solid #ccd6e4;border-radius:.5rem;padding:1rem;min-width:0}
.card h3{margin-top:0} details.card{margin:.6rem 0} summary{font-weight:600;cursor:pointer}
details details{margin:.5rem 0} details.card h3{margin:1rem 0 .4rem}
dt{font-weight:600} dd{margin:0 0 .6rem} dd,pre,h3,summary,p{overflow-wrap:anywhere}
pre{white-space:pre-wrap;background:#e9edf3;padding:.8rem;border-radius:.3rem}
.notice{border-left:.25rem solid #49658a;padding:.2rem .8rem}
</style></head><body><main>
<header><p>BuildGuild · Private preparation</p><h1>Review the comparison</h1>
<p>Structural checks finished. Preparation made no model calls and ran no fixtures or plugin hooks. The runner, model availability and provider quota still need verification.</p></header>
<section><h2>Planned work</h2>
<p>The current build runs first. The candidate runs second. Attempts run one at a time.</p>
<div class="cards">${buildsHtml}</div>
<dl>${definition('Trial', `${trial.slug} · v${trial.version}`)}
${definition('Trial snapshot SHA-256', trial.sha256)}
${definition('Total planned attempts', totalAttempts)}
${definition('Attempts per case per build', settings.runs)}
${definition('Model', settings.model)}
${definition('Required Claude Code version', settings.requiredRunnerVersion)}
${definition('Effort', settings.effortSource)}
${definition('Acceptance', settings.acceptance)}</dl></section>
<section><h2>Budget and actual cost</h2>
<dl>${definition('Requested total limit', `USD ${settings.requestedMaxCostUsd}`)}
${definition('Actual cost', 'Unknown')}</dl>
<p class="notice">The requested limit is split equally between the two builds. It does not estimate the charge. The runner checks its allocation before starting each attempt. An attempt already in flight can exceed it.</p></section>
<section><h2>Task prompts and grader checks</h2>${tasksHtml}</section>
<section><h2>Data and retention</h2>
<p>Preparation files and comparison results are private local files. Execution runs trusted fixtures and hooks as you. The configured model provider processes trial inputs during execution. Final responses and grader text stay in the local results. The runner also retains sealed temporary sandboxes and traces.</p></section>
<section><h2>Execute the reviewed plan</h2>
<p>Run this command when you are ready to start model calls. It includes the plan SHA-256 to bind execution to the reviewed settings.</p>
<dl>${definition('Plan SHA-256', planSha256)}</dl>
<pre><code>${escapeHtml(executeCommand)}</code></pre></section>
</main></body></html>
`;
}
