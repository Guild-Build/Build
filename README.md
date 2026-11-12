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

[`cli/README.md`](cli/README.md) describes every command. Start a private comparison
by preparing it offline:

```sh
node cli/buildguild.mjs prepare ./current-build ./candidate-build --trial ./team-tasks \
  --model <explicit-model-id> --max-cost-usd 2 --out ./comparison-review
```

Open `comparison-review/review.html` to inspect the frozen tasks, acceptance checks,
builds and budget. Preparation requires no Claude installation or credentials and
runs no fixtures or models. The page supplies an explicit execution command tied
to the reviewed plan's hash. Running that command later incurs model usage and
produces a private HTML result and JSON record, preserving errors and missing
attempts. It never submits to the public leaderboard. See the CLI guide for runner
trust, provider processing, budget limits and acceptance rules.

## How a build or a trial gets in

By pull request, one build or one trial each. A guild build is a plugin folder in `bundles/<slug>/` with its record in
`content/builds/<slug>.json`. A trial is a record in `content/trials/<slug>.json` with its cases in
`content/trials/<slug>/cases/`. A community build or trial keeps its code in its author's own repository and adds only
its record, which names that repository and carries the author's opt-in. `node cli/buildguild.mjs new build <slug>` and
`new trial <slug>` scaffold a folder that already passes `check`.

Trial authors can start with `--template blocked-handoff` or the default
`--template scoped-config-change`. Each includes synthetic good, bad and boundary
examples outside its task workspace. Run `node cli/buildguild.mjs check-examples
./<slug>` to test those examples against the actual grader definitions offline.
This checks selected grading rules; it does not execute a model or create evidence.

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
`bundles/`, or for a trial buildguild.gg does not publish, stops the plan. A request may add `repeat` (1 to 5, default 1)
to run the same build on the same trial that many times, one run after another; each repeated run's evidence id and files
end in `-rep<k>`, and a queue may name each build and trial pair only once. A maintainer can also start a single request
from the Actions tab with the same fields. Either way the project owner approves each run in the `trials` environment before
it reads the key or spends anything, and an empty queue starts nothing.

A request's `max_cost_usd`, in dollars and cents (the plan refuses more than two decimal places), covers every paid call
of its run. The run first checks the key with one tiny call, or two when the key is organisation-level, and each check
has a budget of 0.25 USD. So 0.5 USD of each ceiling is kept for the check and the trial gets the rest: a 3 USD ceiling
gives the trial 2.5 USD, on every repeat. The plan refuses a ceiling below 0.51 USD, which would leave the trial
nothing, and the run stops before the trial unless a check gets the reply `ok` within its budget. Claude Code holds
each budget to its own cost estimate: the key check can pass its budget by the one reply that reaches it, and the trial
can pass its budget by every agent run already under way when it is reached, up to the request's `concurrency` (1
unless the request says otherwise).

An agent's shell commands run inside Claude Code's sandbox, and a run whose commands never started measures nothing, so
each run checks the sandbox twice:

- **Before the key is fetched**, the sandbox self-test
  ([`.github/scripts/sandbox-self-test.mjs`](.github/scripts/sandbox-self-test.mjs)) runs the trial's own path, the
  CLI's `test` command and `claude plugin eval` with the trial's flags, on a one-case trial in
  [`.github/sandbox-self-test/`](.github/sandbox-self-test/). A stand-in for the model on 127.0.0.1 takes the place of
  Anthropic's API, so no model is asked and nothing is spent. It proves that the agent's own Bash tool ran a command
  inside the sandbox. It passes only when the eval reports exactly the two agent runs that trial asks for, one with
  the build and one without, each with a complete trace of its own, by rule 1 below, that holds one Bash call, the
  self-test command, under an id that appears nowhere else. The stand-in must have received each call's result exactly
  once, under the call's own id, and each command must have exited 0, by Claude Code's own record of it as rule 4
  below reads it, and printed the arithmetic it was given, a seccomp filter turned on and a user namespace other than
  the runner's. Otherwise the run stops before Azure and the key.
- **After the trial**, [`.github/scripts/shell-starts.mjs`](.github/scripts/shell-starts.mjs) reads the eval's raw
  report and every agent trace. The run is not a measurement when any of these holds:
  1. The report and the traces are not complete or do not match. The report must read and list the agent runs, each
     naming a trace of its own: no run names none, no trace is named twice or is missing, every trace found belongs to
     a listed run, and no two run folders hold one trace file through a symbolic or hard link, found by resolved path
     and by device and inode. Each trace must be complete. The file is not empty and every line in it is a JSON
     object. It ends with Claude Code's final result event, and it closes every turn it opened: each `system/init`
     event is followed by its own result event, numbered 0, 1, … in order. Every background task it started, such as a
     command run in the background or a subagent, reports its start and its end in it exactly once each
     (`task_started` and `task_notification`, matched by `task_id`). Every tool request in it, of any tool, has
     exactly one result in it, and every tool result in it answers a request in it. Across all the job's traces no
     tool request id or tool result id appears more than once. A complete trace with no shell command in it is fine,
     and so is a run that uses a subagent or a background command when its trace shows every turn and every task
     ended. An agent run that ends without Claude Code's final result event, for any reason including the eval's own
     time limit, makes the job not a measurement, and the run has to be repeated.
  2. A Bash result is an error that is not a process exit, meaning Claude Code returned an error for the call without
     the command running to an exit status. In the pinned release a command that ran and exited non-zero is the one
     error whose text begins "Exit code <n>". Every other error counts, whatever its wording, Claude Code's own
     refusals and its sandbox bridge errors included, and so does a command interrupted before it finished. Three
     refusals that Claude Code makes before it tries to run a command are allowed: a PreToolUse hook refused the call
     (its result records the hook's decision), the model's input failed validation, or Claude Code blocked a long
     sleep.
  3. A Bash result is a process exit whose output is nothing but the sandbox wrapper's own setup lines: lines shaped
     like bubblewrap's `bwrap: <message>` or the seccomp helper's `apply-seccomp: <step>: <error>`, plus bash's own
     complaints. A result counts whether or not Claude Code marked it an error, because it reads exit status 1 as
     success for `grep`, `find`, `diff` and `test`.
  4. Claude Code tried to run at least one shell command for the agents and not one of them exited 0. A result Claude
     Code did not mark an error is not always an exit 0: it reads exit status 1 as success for `grep`, `find`, `diff`,
     `test` and a few more, and it answers at once for a command it runs in the background, as it does when a command
     runs past its timeout. Claude Code's own record of each result in the trace says which, and only a result
     recorded as neither, and not interrupted, counts. A subagent's Bash results carry no such record in the pinned
     release, so they never count as an exit 0: a job whose only shell commands ran in subagents is not a measurement.

  A trial whose agents asked for no shell command at all is still a measurement. The check has two limits. Rule 3 also
  counts a command that started and printed nothing but such lines, which can only reject a run, never accept one. And a
  wrapper failure that exits with a status, prints something besides those shapes and hits only some commands is not
  detected by this check, nor is one that hits only commands run in the background, whose exit comes later, outside
  their Bash results; the self-test before the key and the pins guard against it.

  Both checks guard against a fault in the environment: a runner image, a tool release, a bridge or a crash that keeps
  shell commands from starting, or leaves the report or the traces cut short, missing or unreadable. They are no
  defence against someone who can write the eval's own report and trace files, because whoever can do that can write
  the grades too, and a sandboxed agent cannot reach those files. A forged record, one no Claude Code release writes,
  is therefore outside what they check.

  When the run is not a measurement, the job fails and its summary names each reason that applied, with counts, and
  quotes the first error. Its files upload as `not-evidence-<build>-<trial>`, with the record renamed
  `not-evidence-<build>-<trial>.json` beside `NOT-A-MEASUREMENT.txt`.

The trial job is pinned so that a new runner image or Claude Code release cannot silently stop the sandbox. It runs on
`ubuntu-24.04`, not `ubuntu-latest`: on `ubuntu-26.04`, AppArmor's `bwrap-userns-restrict` profile kept the sandbox's
seccomp helper from starting any command with each of the three Claude Code releases tried (2.1.309, 2.1.311 and
2.1.322). Claude Code is pinned in
[`.github/scripts/install-trial-tools.sh`](.github/scripts/install-trial-tools.sh), which the trial job and the free
[sandbox self-test workflow](.github/workflows/sandbox.yml) both run. To move a pin on purpose:

1. Change the version in the install script, or `runs-on` in both `trial.yml` and `sandbox.yml` (a test keeps them
   equal), in a pull request.
2. The sandbox self-test workflow runs on that pull request at no cost. Merge only if it passes. If it fails, the pin
   stays where it is.
3. For a new Claude Code release, also check again how it writes a Bash result, against its source. Rules 2 and 4 of
   the after-trial check read its Bash results and their records as 2.1.322 writes them, and rule 1 reads its result
   events and their `result_index`, its `system/init` events, and its `task_started` and `task_notification` events
   with their `task_id`. The self-test only runs a command that exits 0. [Pull request
   15](https://github.com/Guild-Build/Build/pull/15) lists where 2.1.322 writes them.

Moving to `ubuntu-26.04` also needs its `bwrap-userns-restrict` profile out of the way, which is a change to the
runner's security settings. That pull request must name the change and give its reason.

A guild record's attestation is the public URL of the run that produced it,
`https://github.com/Guild-Build/Build/actions/runs/<run id>`. Anyone signed in to GitHub can read the run's log there
and download its files. The files are the evidence record, the raw report, the results and the agent traces, all
scanned for the key before upload.

[buildguild.gg](https://buildguild.gg/) is built from these records and bundles. Licensed under the Apache License 2.0
([`LICENSE`](LICENSE)).
