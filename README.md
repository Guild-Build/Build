# Build

The build side of [BuildGuild](https://buildguild.gg/): the `buildguild` CLI, the guild's own builds, and the records
buildguild.gg computes its tiers from. A build is the whole configuration a coding agent runs with (skills, subagents,
hooks, MCP servers, playbooks, agent profiles), packaged as a Claude Code plugin. A trial is a versioned set of tasks with
deterministic graders. An evidence record is one run of a build on a trial.

| Path | What it holds |
|---|---|
| `cli/` | The `buildguild` CLI (`buildguild.mjs`, Node 22 or later, no dependencies) and the build manifest rules it checks (`manifest.mjs`). It becomes the npm package `buildguild` once that is published. |
| `bundles/<slug>/` | The guild's builds as Claude Code plugin folders, each with a `buildguild.json` manifest. |
| `content/builds/` | One record per build. |
| `content/trials/` | One record per trial, with its cases under `content/trials/<slug>/cases/`. |
| `content/seasons/` | Season records: dates and the ranked trials. |
| `content/evidence/<build>/` | Accepted evidence records. Tiers are computed from them; no record carries a tier. |
| `content/modules/<type>/` | One record per module. Third-party modules are linked to their own repositories, never copied here. |
| `.github/` | The Season trial workflow (`workflows/trial.yml`) and its queue (`trial-queue.json`); see [Season trials](#season-trials). |

## Run the CLI from a checkout

The `buildguild` npm package is not published yet, so do not run it with `npx`. Clone this repository and run the CLI
from its root:

```
git clone https://github.com/Guild-Build/Build.git
cd Build
node cli/buildguild.mjs list
node cli/buildguild.mjs add measured-delivery --scope project
node cli/buildguild.mjs test measured-delivery --model claude-sonnet-5-5 --max-cost-usd 5
```

[`cli/README.md`](cli/README.md) describes every command.

## How a build or a trial gets in

By pull request, one build or one trial each. A guild build is a plugin folder in `bundles/<slug>/` with its record in
`content/builds/<slug>.json`. A trial is a record in `content/trials/<slug>.json` with its cases in
`content/trials/<slug>/cases/`. A community build or trial keeps its code in its author's own repository and adds only
its record, which names that repository and carries the author's opt-in. `node cli/buildguild.mjs new build <slug>` and
`new trial <slug>` scaffold a folder that already passes `check`.

Before you open the pull request, run from the repository root:

```
node --check cli/buildguild.mjs
node cli/buildguild.mjs check <folder>
claude plugin validate --strict bundles/<slug>
```

The last check applies to any bundle you add or change. A maintainer runs the same checks before merging, and a new
build or trial starts at Declared. You can also send one from [buildguild.gg/submit](https://buildguild.gg/submit/) or
with `node cli/buildguild.mjs publish <folder>`; a maintainer who accepts it opens the pull request.
[`CONTRIBUTING.md`](CONTRIBUTING.md) says where evidence comes from.

## Season trials

Guild-run evidence comes from the Season trial workflow in this repository,
[`.github/workflows/trial.yml`](.github/workflows/trial.yml). Each run tests one build from `bundles/` on one trial as
buildguild.gg publishes it, with the official eval runner, one run at a time and a cost ceiling.

A maintainer queues runs with a pull request that changes [`.github/trial-queue.json`](.github/trial-queue.json):
increase `run` by one and list the requests, each naming a `build`, a `trial`, a `max_cost_usd` ceiling and a pinned
`model`. When it merges into `main`, the workflow plans one run per request; a request for a build that is not in
`bundles/`, or for a trial buildguild.gg does not publish, stops the plan. A maintainer can also start a single run from
the Actions tab with the same fields. Either way the project owner approves each run in the `trials` environment before
it reads the key or spends anything, and an empty queue starts nothing.

A guild record's attestation is the public URL of the run that produced it,
`https://github.com/Guild-Build/Build/actions/runs/<run id>`. Anyone can read the run's log there, and anyone signed in
to GitHub can download its files: the evidence record, the raw report, the results and the agent traces, all scanned
for the key before upload.

[buildguild.gg](https://buildguild.gg/) is built from these records and bundles. Licensed under the Apache License 2.0
([`LICENSE`](LICENSE)).
