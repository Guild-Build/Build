# buildguild CLI

The command-line companion to [buildguild.gg](https://buildguild.gg/). Node 22 or later, no dependencies.

Run from a checkout of [github.com/Guild-Build/Build](https://github.com/Guild-Build/Build); the `buildguild` npm package is not published yet, so do not run it with `npx`.

```
node cli/buildguild.mjs new build my-desk
node cli/buildguild.mjs new trial my-tasks --template scoped-config-change
node cli/buildguild.mjs check-examples ./my-tasks
node cli/buildguild.mjs check my-desk
node cli/buildguild.mjs publish my-desk
node cli/buildguild.mjs list
node cli/buildguild.mjs show measured-delivery
node cli/buildguild.mjs add measured-delivery --scope project
node cli/buildguild.mjs test measured-delivery --model claude-sonnet-5-5 --max-cost-usd 5
node cli/buildguild.mjs test my-desk --trial ./my-tasks --model claude-sonnet-5-5   # your own trial folder: a local run, not evidence
node cli/buildguild.mjs submit evidence.json
node cli/buildguild.mjs test runbook-first --trial client-deployment-v1 --unpublished ./hidden-cases --model claude-sonnet-5-5 --runner <your-login> --raw-out ../private/raw.json --work-dir ../private/run   # a guild maintainer's hidden-slice run
```

`new` scaffolds a build or a trial that already passes `check`. `check` runs the manifest, skill, hook, grader front-matter and fixture checks (and `claude plugin validate --strict` when Claude Code is installed); it catches the authoring mistakes the eval runner skips silently. For a trial it also refuses symlinks under `cases/`, which a published archive cannot carry, and it reports a fixture that names a network tool without running it. `publish` runs `check`, shows exactly what will be sent, asks for the rights and naming consents, and posts the submission.

`add` downloads the build's archive from the site, verifies its SHA-256 against the build record, unpacks it under `.claude/plugins/buildguild/<slug>/` (and `.agents/skills/` with `--target codex` or `all`), and records every file in `.buildguild/lock.json` so `remove` reverses it exactly, emptied folders included. It refuses, before writing anything, to overwrite a file under `.agents/` that the lock does not record for that build, such as a skill of your own.

`test` downloads a published trial's cases (`--trial <slug>`, default `guild-smoke-v1`), copies them into the bundle's `evals/`, runs `claude plugin eval` on the model you name with `--model` (required; `ANTHROPIC_MODEL` may stand in for it) and the cost cap you give, and wraps the report into a `buildguild.evidence.v1` file with the environment fingerprint.

`environment.modules` records each module's `ref` and GitHub commit `sha` at run time, with `sha: null` for non-GitHub sources or unavailable lookups.

After guarding `--work-dir`, `test` checks that Claude Code is installed before resetting the work directory or downloading anything. It then stages the bundle and resolves module pins before starting `claude plugin eval`. The `pinned <n> of <m> modules` summary counts the valid refs recorded, up to 60 entries.

`--trial <path>` runs a trial folder of your own instead, such as one made by `new trial`. A value that starts with `.` or holds a slash is a path; a bare name is a folder only when it holds `trial.json`, so an unrelated folder never hides a published slug. `test` first runs the trial checks `check` runs and stops on any problem, before it looks for Claude Code or downloads anything, then writes the folder's `cases/` into `evals/` the way a published trial is unpacked: the same layout, `.sh` files executable and the rest not. The run is for you, the author: it is written to `local-run.json`, marked `"trialSource": "local"` with the slug and version from the folder's `trial.json`, and `submit` refuses it. The raw report (`--raw-out`) carries the same marker, and `wrap` refuses a marked report for a published slug. Evidence comes only from a run on a published trial. `wrap --trial <path>` marks its record the same way.

`--work-dir <dir>` is deleted before the run, so `test` refuses, before deleting anything, one that is the filesystem root, your home directory, the current directory or one of its ancestors, or the build or trial folder, a folder inside either (one not created yet included), or a folder that holds either.

`--rep <k>` marks the run as number `k` (a whole number of at least 1) of several runs of the same build on the same trial. The evidence id then ends in `-rep<k>`, and so does the default file name (`evidence-rep<k>.json`, or `local-run-rep<k>.json` for a trial folder of your own); a name you give with `--out` or `--raw-out` is used as you give it. Nothing else changes: the runner gets the same arguments. Without `--rep`, every id and file name is as before. A bad value is refused before anything runs.

The hosted Season trial workflow (`.github/workflows/trial.yml`) passes `--rep` when the owner asks for repeated runs. A request in `.github/trial-queue.json`, or the Actions tab's inputs, may add `repeat`, a whole number from 1 to 5 (default 1; a `repeat` of `null`, like an empty input, also means 1, as `null` means the default for the queue's other optional fields). The workflow then runs the build on the trial that many times, one run after another, each waiting for the owner's approval, so a gap between two builds can be compared with how much one build's score moves from run to run. Run `k` passes `--rep k`, and its evidence file, raw report and uploaded artifact are named `evidence-<build>-<trial>-rep<k>.json`, `raw-<build>-<trial>-rep<k>.json` and `evidence-<build>-<trial>-rep<k>`. A request without `repeat`, or with `repeat` 1, runs once with the names it always had. Before anyone is asked to approve, the plan refuses a `repeat` outside 1 to 5 or not a whole number, a field it does not know, and a second request for a build and trial the queue already names (ask for more runs with `repeat` instead). It also refuses two runs that would upload under one artifact name, which different requests can reach because hyphens join the parts of a name: build `a-b` on trial `c` against build `a` on trial `b-c`, or a trial whose slug ends in `-rep1` against run 1 of a repeated request. Queue one of them separately. The run summary then shows each request's repeats, and its total is each cost ceiling times its repeats.

`submit` publishes that file as a public Gist from your own GitHub account (`gh gist create`) after showing you exactly what will be sent, then posts the summary and the Gist link to the guild. It refuses a record marked local, and a hidden-slice record (below), before it calls `gh`, so no Gist is made.

## Run unpublished cases as a hidden slice

A published trial can have an unpublished part, its hidden slice: cases no build author has seen, run by a guild maintainer so a build cannot be tuned to them. The cases sit in a private trial folder of the usual shape (`trial.json`, `README.md`, `LICENSE`, `cases/<name>/`), and a maintainer runs them on the maintainer's own machine, because a hosted run would publish its traces and so the cases:

```
node cli/buildguild.mjs unpublished ./hidden-cases
node cli/buildguild.mjs test <published-build> --trial <published-slug> --unpublished ./hidden-cases --model claude-sonnet-5-5 --runner <your-login> --raw-out ../private/raw.json --work-dir ../private/run --max-cost-usd 5
```

The mode takes one kind of run: a published build, on the folder's cases exactly as their checksum fixes them, in the public trial's form, once. It creates its outputs and overwrites and deletes nothing.

**What it promises.** A record from this mode describes one complete run, by this invocation, of the published archive on the folder's cases. It trusts the published archive to be the build it claims to be: a build whose own code sets out to falsify its run (a hook that rewrites the cases or the report while the agents work, say) is outside what any run on a maintainer's machine can rule out, here as in ordinary and hosted runs. What the build's manifest or the runner's report states plainly, the mode acts on: an archive whose manifest names an eval folder of its own is refused, and a report that does not show the build loaded gives no record.

`unpublished <trial-folder>` takes no flag. It runs the folder checks that run nothing (the argument, the roster, the case names, the structure, the names under `cases/` and the public trial's form, as below; no fixture, no model) and prints the number of cases and their checksum, so both can be published before the run.

`test --unpublished <trial-folder>` takes these flags, refuses any other by name, and refuses a flag given twice or without its value:

- `--trial <published-slug>`, the published trial the cases are the unpublished part of, by slug;
- `--unpublished <trial-folder>`;
- `--model <id>` (or `ANTHROPIC_MODEL`), and `--runner <login>`, the GitHub login the record credits (required here: the tool does not guess it);
- `--raw-out <new-file>` and `--work-dir <new-folder>`, required, so the private outputs are where you choose, and `--out <new-file>` for the record (by default `evidence-unpublished.json`, or `evidence-unpublished-rep<k>.json` with `--rep k`);
- `--role guild`, the only role, and the default;
- `--max-cost-usd`, `-j` (1 to 8), `--rep` and `--keep-temp`, as in any run.

It refuses `--runs` because the number of runs is part of each case, which the checksum fixes, so each case runs exactly as often as it declares; and `--no-fixtures` because every unpublished folder gets the fixture check. The build must be a published build, named by its slug, so the record is always about an archive whose SHA-256 the tool has checked; a folder, or any path that exists here, is refused.

**Outputs.** `--out` and `--raw-out` must name files that do not exist yet, and `--work-dir` a folder that does not exist yet, each in a folder that does exist and that this user can create files in, not inside the unpublished folder, and no two of them the same path, even where case is ignored (as on macOS). The files are created with exclusive creation and the run folder with `mkdir`, so a path that appears after the check fails instead of being written through: what appeared there is left as it is, and the command stops (exit 1) without writing a record. Inside the run folder, which this run creates, the runner writes its report and the tool then adds its marker to it.

**Case names.** A case folder's name is lower-case letters, digits and hyphens, starting with a letter or digit. It is not a word YAML reads as other than text (`true`, `false`, `null`, `yes`, `no`, `on`, `off`, `y`, `n`, a number or a date), and not a name the runner's case discovery skips (Claude Code 2.1.321 skips `results`, `mocks`, `node_modules`, `.claude` and `.git`).

**The public trial's form.** The files that define a case must be written as the published trials' cases are (as in `content/trials/client-deployment-v1/cases/`), in a small exact subset checked line by line, so that the runner (Claude Code 2.1.321, which reads them with `Bun.YAML.parse`) reads each case as the check does: named after its folder, each grader after its file, every grader scoring both arms, the build the only plugin. Anything else is refused, never interpreted:

- each case has a `prompt.md`, and `case.yaml`, `prompt.md` and the graders are UTF-8 text without a carriage return (a case's other files, fixtures among them, are not read here);
- `prompt.md` and each file under `graders/` open with a line that is exactly `---`, and their front matter ends at the next line that is exactly `---`, with no `---` anywhere between (the runner ends front matter at the first `---` it meets, even inside a line, and skips a grader file that has none);
- every line of a front matter, and of `case.yaml`, is `key: value`, a bare lower-case key from the file's list, given once, with a value in the one form given for it:
  - `prompt.md`: `tags` and `allowed_tools`, each a list written `[a, b]` (lower-case words, tool names); `runs` (1 to 50), `max_turns` (1 to 200) and `timeout_seconds` (1 to 3600), whole numbers. The prompt follows the front matter; it may not be empty or hold the runner's blank template text;
  - a grader: `type: regex`, with `pattern` (required: one single-quoted line with no quote inside, a valid regular expression), `flags` (letters from `dgimsuvy`), `match` (`contains` or `not_contains`), `target` (`last_message`, or no value and then the two lines `  source: file` and `  path: <relative path>`) and `weight` (a number above 0); or `type: tool_used` only as the one public grader of that type writes it: `tool: Read` (required), with `input_match` (written as `pattern` is), `min` and `max` (whole numbers) and `weight`;
  - `case.yaml`, which may be left out (the runner then names the case after its folder): `schema_version: "1.1"` and `name:` with the folder's name, both required, and optionally `context:` followed by the one line `  scaffold_script: <a file of the case>`;
- `cases/` holds the case folders and no file, `graders/` holds grader files only, each `<name>.md`, and no case folder holds a plugin manifest (`plugin.json` or `.claude-plugin`), which the runner would load for that case in place of the build.

These keys are the ones the public trial's eight cases use, and a test runs these checks over them. So no case can be renamed, list graders in `case.yaml`, name a grader, set an `arm`, use a with-only grader (a `tool_used` grader of `Skill`, a grader of `mock_calls`) or load a plugin of its own.

**The preflight.** Every check that needs neither the build's archive nor a run is made first, each refusal with a plain message, in this order: the flags (their names, none twice, each with a value); `--model`, `--rep`, `--runner`, `--max-cost-usd` and `-j`; `--raw-out` and `--work-dir` being given; the role; the trial's slug; the build's slug; the folder (that it exists, has a `trial.json` that parses and lists at least one case; its roster, `trial.json` listing each case once by name with its list exactly the folders under `cases/`; the case names; its structure, every check `check` runs on a trial folder except running its fixtures; the names under `cases/`; then, on the cases' bytes, read once here, the public trial's form and their checksum); the three outputs; the published trial, read from the site, and the case names it shares with the folder; the published build and its archive record, read from the site; and Claude Code being installed. A run the preflight refuses runs, creates and writes nothing and downloads no archive; a test in `tests/unpublished-cases.test.mjs` checks that for every refusal the preflight names.

**The run.** Only after the preflight do the folder's fixtures run, as `check` runs them; then the run folder is created, the build's archive downloaded and its SHA-256 checked, and the archive unpacked into the run folder without its `evals/`, whose place the cases take, and without any `buildguild-raw.json`. If an entry named otherwise still lands on either (through a `.` in its path, or a name that differs only in case on a file system that ignores case), the runner is not started and no record is written. So the report read after the run is this run's: without one, no record is written. The build's manifest, `.claude-plugin/plugin.json`, must be a JSON object; if it, or a `plugin.json` at the archive's top, names an eval folder of its own (`experimental.evals`, or `evals`), or if it does not name the build, with a version, the runner is not started. The run is given the case bytes the preflight read, the ones the checksum was taken from. Only the folder's cases run, both arms, with the runner arguments of any other run and `--eval-dir evals`; the published trial's own cases are not downloaded.

That only the folder's cases run rests on six things: the run folder is new, and nothing of the archive lands on `evals/` or on the report's path; the cases are written there from the bytes the checksum fixes; the runner is told `--eval-dir evals`, and no manifest of the build names another eval folder; every case folder has a name the runner's discovery takes, `cases/` holds nothing else, and no case folder holds a plugin manifest; each case is in the exact form above, so the runner names it after its folder; and the report must list exactly the folder's cases, each read from the run folder's `evals/<name>`, with the build loaded.

**A record only for a complete run** on exactly the folder's cases, by one set of checks that `test` and `wrap` both apply. The runner (Claude Code 2.1.321) exits 0 when it finished; 1 when a case scored under `--threshold` (0 here, so no case can), a case did not load, the harness failed, a run ended on an API error, or its git check failed; 2 for a partial report (the cost ceiling, an interruption, a failed sign-in); and 130 when interrupted before any case ran. The exit status is kept in the report's marker, and only 0 is taken. The run must not be partial; it must have run with and without the build, on the model the record names (where the raw report says which); the report must show the build loaded in the arm with it: one plugin, with the name and version the build's manifest gives, loaded from the run folder, which is also the suite's root, and no problem reported for it (the runner reports `manifest_invalid`, `disabled_by_default`, `identity_unverified`, `archive_not_probed` or `will_not_load`; this is `pluginLoaded` in `cli/comparison-results.mjs`, which comparison runs apply too); the raw report must hold exactly one result for each of the folder's cases and no other, each read from the run folder's `evals/<name>` where the report says where a case came from, with a case total that agrees; each arm of each case must hold exactly the runs the case declares; every run must be complete; and every score must be the one its parts give (a case's score is the mean of its runs, its gap is its score minus its bare score, and the overall score and the mean gap are the means over the cases). A run is complete when the runner graded it: every grader of the case has a result marked scored, the score is a number from 0 to 1, no paid grader was skipped, and the run was not aborted. The runner grades a run that ended in an ordinary error (out of turns, say) like any other, so such a run is a measurement, as in every record: the tool prints a note counting such runs and writes the record. A run the runner aborted, or that never reached grading (an API error, a failed scaffold), is incomplete. Otherwise `test` writes no record, says what was wrong (naming cases only as `unpublished-<n>`) and exits 2; the raw report is still saved, marked, to work out what happened. An ordinary run is not affected.

The record (default `evidence-unpublished.json`) is a `buildguild.evidence.v1` record that differs from an ordinary one in these ways:

- `trial` is the published slug and `trialVersion` the published trial's current version;
- `hiddenSlice: true`, `role: "guild"`, `gist: null`, and no `trialSource`;
- in `results.cases`, the cases are `unpublished-1` to `unpublished-n`, numbered in the sorted order of their real names (byte order), with their scores and gaps over the bare runtime kept;
- `results.dimensions` are computed as for any record, from the cases' dimensions in the folder's `trial.json` at the run;
- `results.bareOverallScore` is the bare runtime's overall score on the same cases: the mean of each case's `aggregates.scoreWithout` in the raw report (the score of the arm without the build), just as `overallScore` is the mean of each case's `aggregates.score`;
- `unpublishedCases: { count, sha256 }` holds the number of cases and the checksum of the folder's `cases/`.

The checksum is the SHA-256 of a text with one line per regular file under `cases/`, sorted by the bytes of its path: the mode the run writes the file with (`755` for a `.sh` file, `644` for any other), a space, the SHA-256 of the file's bytes, a space, and the path relative to the folder (`cases/<name>/...`), then a line feed. File times, modes on disk, the folder's own path and the order the disk lists files do not enter it. Every name under `cases/`, of a folder or a file, must be made of letters, digits, `.`, `_` and `-`, and be neither `.` nor `..`; the preflight refuses any other, so every path fits on its line. A reader recomputes the checksum by hand from the folder:

```
cd hidden-cases && find cases -type f | LC_ALL=C sort | while IFS= read -r f; do case "$f" in *.sh) m=755;; *) m=644;; esac; printf '%s %s %s\n' "$m" "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$f"; done | shasum -a 256
```

(`sha256sum` in place of `shasum -a 256` on Linux.)

The record names no case, prompt, fixture or folder path. The run folder and the raw report do: they hold the cases' names and prompts. Before the run, `test` prints one warning naming the run folder, its raw report and the `--raw-out` copy, and saying they must not be committed, uploaded or pasted anywhere. The raw report is marked `"trialSource": "unpublished"`, so a plain `wrap` refuses it, and carries `unpublishedRun`, every fact of the run its record needs: the published trial and version, the cases' real names, their dimensions and their graders at the run, the count and checksum, the build, its version and archive checksum, the plugin the run loads (its manifest's name and version, and the run folder), the runner, the date, the `--rep` suffix, the environment (module pins included) and the runner's exit status.

`wrap <raw.json> --unpublished <trial-folder> --trial <published-slug> --model <id> --out <new-file> [--build <slug>] [--build-version v] [--sha256 s] [--runner login] [--role guild]` rebuilds the record from that raw report without a second paid run, into `--out`, a new file as above; it refuses any other flag by name. Every fact comes from the report and its marker, so its record equals the one `test` wrote apart from the random part of its id; a `--model`, `--build`, `--build-version`, `--sha256` or `--runner` that differs from the run's is refused rather than written in. It refuses a report without a complete marker, another published trial, a published trial that has moved to another version since the run, a folder that fails the checks that run nothing (`wrap` runs no fixture), a folder whose cases no longer match the run's count and checksum, and a run that is not complete, by the same checks as `test`, the recorded exit status among them. If the folder's `trial.json` now gives a case another dimension, `wrap` says so and keeps the dimension the case had at the run.

`submit` refuses a hidden-slice record: a maintainer adds it to Build by pull request, never as a Gist.

`check` uses the same build manifest rules as the planner and draft API. Build manifests include name, summary and licence as well as profiles and modules; each profile has a one-line limits statement of at least ten characters. Private checks and exports do not require listing consent. The internal `bundles/bare-runtime` trial control intentionally has no modules and uses the baseline category; it is not an authorable build and does not pass these checks.

`npm pack` stages the CLI and the shared validator together without adding dependencies.

## Start a trial and test its graders offline

```sh
node cli/buildguild.mjs new trial my-handoff --template blocked-handoff --author my-name
node cli/buildguild.mjs check-examples ./my-handoff
```

Choose `blocked-handoff` to check a documentation edit, a matching test command
and a structured dependency-blocker report. Choose `scoped-config-change` to check
a requested configuration value and preservation of a protected file. Omitting
`--template` selects `scoped-config-change`; the old placeholder DONE-file task is
replaced. Trial creation uses `--author`, otherwise the local `USER` value or
`your-login`. It never looks up a GitHub identity. Template provenance and the
Apache-2.0 source licence are retained alongside the new trial's declared licence.

Each template includes 11 synthetic passing, failing and boundary outcomes in
`reference-examples.json`. `check-examples` reads the actual grader Markdown files
and compares their decisions with the expected results. A missing case, grader
expectation, positive/negative coverage, or boundary example fails the check.
Changing a grader without updating its known outcomes can fail the check too.
Exit 0 means the examples matched; exit 1 means a mismatch or unsupported input.
This command needs only Node. It executes no fixtures, tool calls, models or
network requests and writes no model evidence.

The examples stay at the trial root, outside `cases/`. Comparison snapshots retain
them for authors, but only `cases/` is staged into the evaluated build. Do not copy
answer examples into a fixture workspace. Inspect fixtures before running the
separate `check` command, which can execute them. Edit the task, grader and reference
outcomes together; version semantic changes before comparing real results.

The reference schema is `buildguild.grader-examples.v1`. It has a `cases` array;
each case has `name` and `examples`. Every example has:

- A unique `id`, `description`, and `category`: `pass`, `fail` or `boundary`.
- `lastMessage`, hypothetical final `files` keyed by relative literal paths, and
  `changedFiles`, the separate list of changed-file paths.
- `toolCalls`, each with a tool `name` and JSON-serialized input object in `inputText`.
- `expected`, a boolean for every actual grader name (its filename without `.md`).

The supported checker semantics were inspected in Claude Code 2.1.314. This is a
narrow reference checker, not a replacement eval runner:

| Grader | Supported reference input |
| --- | --- |
| `regex` | `last_message` or one literal file; JavaScript regex flags; `contains` or `not_contains`. A missing file fails either mode. |
| `file_exists` | One literal path in `changedFiles`, with `exists: true` by default. The runner checks its changed-file list, not all files already in the workspace. |
| `tool_used` | Exact tool name, optional regex over serialized `inputText`, and integer `min`/`max` bounds. Default minimum is one. |

Front matter supports plain keys, single-line quoted strings, a file `target`
mapping, optional positive `weight`, and optional `arm: both`. Duplicate keys,
unknown fields, advanced YAML, glob paths, trace targets, count-mode regexes and
other grader types are rejected rather than approximated. References are for one
supplied outcome; they do not simulate ablation or compute weighted model scores.
Numbers and booleans must be unquoted; patterns and other text remain strings.
Literal paths cannot contain line breaks or leading/trailing whitespace. Cases
use the same bounded `prompt.md`/`case.yaml` format as private comparison below;
inline YAML graders are rejected so additional checks cannot escape coverage.

These tests show that selected rules distinguish known examples. They do not prove
model quality, general grader correctness, or that a tool call actually succeeded.
Free prose rejected by the handoff format is not evidence of dishonesty. The scoped
configuration checks cover two file states, not every edit in a workspace.

## Compare two local builds privately

Prepare your current build and a candidate on tasks you own before spending:

```sh
node cli/buildguild.mjs prepare ./current-build ./candidate-build \
  --trial ./team-tasks --model <explicit-model-id> \
  --max-cost-usd 2 --out ./comparison-review
```

`prepare` works offline without Claude, credentials or provider requests. It checks
the local structures, copies and hashes the inputs, and writes `plan.json` plus a
self-contained `review.html`. It does not execute fixtures, hooks, validators or
models. Review the exact task prompts, acceptance checks, repeats, total attempts,
build identities and equal budget allocations before choosing to run. The stated
budget is a stopping threshold, not an estimate of actual cost or a hard billing
ceiling. Provider quota, model availability and runtime readiness remain unknown.

The review and terminal output provide the next command, including the SHA-256 of
the exact plan bytes:

```sh
node cli/buildguild.mjs compare --plan ./comparison-review/plan.json \
  --plan-sha256 <hash-from-review> --out ./comparison-001
```

This command starts model usage. It verifies the plan digest and every saved input
hash, reconstructs the expected task and settings record, and uses the existing
comparison runner. It never executes a command stored in JSON. Settings cannot be
overridden during execution; prepare a new review to change the model, repeats,
budget or inputs. Changes to the original source folders do not alter the saved
preparation. Keep its whole folder: the plan alone is not a portable build bundle.
The result's `plan.json` records `preparationSha256`. The preparation is private
and is not accepted as public season evidence or proof that a build works.

For an immediate run when you have already reviewed the inputs, the original
single-step command remains available:

```sh
node cli/buildguild.mjs compare ./current-build ./candidate-build \
  --trial ./team-tasks --model <explicit-model-id> \
  --max-cost-usd 2 --out ./comparison-001
```

The output directory must be new, its parent must exist, and it must not overlap
an input folder. Inputs are ordinary build folders with `buildguild.json` and
`.claude-plugin/plugin.json`, and a local trial folder with `trial.json` and
`cases/` (use `new build` / `new trial` to start). The command checks these
structures without executing fixtures. Only deterministic `regex`, `file_exists`
and `tool_used` graders are supported. Every listed grader must complete and pass
for an attempt to be accepted; a high average does not compensate for a failed
check. Use checks that express the task's actual acceptance criteria.

Private preparation and comparison use the local authoring template's format:
each case needs `prompt.md` and `graders/*.md`. An optional `case.yaml` may contain
only `schema_version: "1.1"`, the matching case `name`, and `context` with a
two-space-indented `scaffold_script` path inside the case directory. Blank lines
and comments are allowed. Advanced YAML, duplicate keys, extra execution fields
and inline graders are rejected before any runner access. Put execution settings
in the prompt's front matter and acceptance checks in grader Markdown files. This
restriction prevents hidden instructions or paid graders from bypassing review;
it does not change the public trial format or the separate `check` command.

The command snapshots both builds and the trial, hashes file paths, normalized
executable modes and contents, then runs each build on the same trial. It uses
`--ablation none`, an explicit `--eval-dir evals`, and three attempts per case
(`--runs N` overrides this, up to 100). The current build runs first; the candidate
runs second. The actual returned attempt roster is checked against this explicit
repeat plan; the raw runner report may retain the case's original `runsPerCase`
value, which is recorded separately as `declaredRunsPerCase`. These are descriptive repeated measurements, not a randomized or
statistically paired experiment. A single attempt is reported as inconclusive.

The named model overrides case models as supported by the runner. The report
records the requested model, observed runner version, input hashes, and exact
invocations. A complete report requires the runner to confirm the staged plugin
identity, successful loading, requested model, evaluation mode and concurrency.
Response capture is verified against Claude Code **2.1.314**. `compare` stops
before evaluation on another version or when `--keep-temp` is unavailable,
because the trace format is not a published stable interface.
Capture requires a non-root POSIX user so the runner can seal retained sandboxes.
Aborted attempts are errors even when a grader reports a pass. Effective effort is unknown: `plugin eval` does not expose it.
`--effort` is rejected by `compare`, `test` and `wrap` rather than recording a
setting that was never applied. Model aliases and external services can change;
local content hashes alone do not guarantee deterministic reproduction.

The requested total budget is split equally. If the first run's reported cost is
unknown, or leaves less than the same allocation for the second, the second is
not started. The runner checks its cap before launching each attempt; an in-flight
attempt can exceed it. This is not a strict billing guarantee. No extra run is
started to retry a failure. Exit 0 means both arms have complete, interpretable
results, not that the candidate passed every task. Exit 2 means inconclusive;
exit 1 reports an invalid request or preflight failure.

Open `report.html` in a browser. `comparison.json` holds the corresponding
`buildguild.comparison.v1` record, including every planned attempt, acceptance
failures, missing/ungraded results, known cost/time and descriptive case changes.
`plan.json` is written before execution. `inputs/` contains rerunnable snapshots;
`work/` contains each evaluated copy; `runs/` contains invocations and fresh raw
reports outside the evaluated input tree.
Each arm also has `responses.json`, with case and attempt identities, source trace
hashes, and two separately sourced text fields. `finalResponse` comes from a
successful main-thread terminal result; `graderTargetText` matches the runner's
`last_message` target (the last assistant event with text blocks, including child
assistant events). The HTML shows both when they differ. Tool and thinking blocks
are excluded. Incomplete or unreadable traces are explicit; they make the comparison
inconclusive and prevent starting the second build when detected in the first.
Saved input hashes are rechecked around execution. A change invalidates the
comparison and skips further runs; the original source folders are not restored
or modified. An incomplete report is saved after the first arm. Existing output is never
overwritten. The rerun command uses the saved inputs and a new output directory.

Private means no public upload: this schema cannot be submitted as season
evidence. Output is owner-only on POSIX systems (directory mode 0700); the HTML has
no external assets or scripts. Raw reports and snapshots can contain sensitive
source, so retain them only in an approved local location and do not commit them.
Responses can also contain sensitive content. The command uses `--keep-temp`:
besides the extracted responses, the runner retains its sealed temporary sandboxes
and full traces. Successfully read trace paths are inventoried in `responses.json`;
unreadable paths remain in `raw.json`. These temporary directories are outside the
comparison folder (`/private/tmp/e-*` on macOS, `claude-eval-*` under the system
temporary directory elsewhere). Deleting the comparison folder
does not delete them. The command leaves the runner's seals intact and does not
recursively inspect or reopen sealed directories for cleanup. Apply your retention
policy to the exact reported roots; do not delete a broad temporary-file glob.
The model provider still processes trial inputs. Fixtures and hooks run as your
user: fresh working copies are not a security sandbox. Run only trusted inputs;
validate your provider and customer data-handling requirements first. Input links,
special files and known credential filenames are rejected; this is not a general
secret scanner. Root `.git` and existing build `evals/` directories are excluded
from snapshots. User inputs themselves are not edited.

## CLI release checks

```sh
node --check cli/buildguild.mjs
node --check cli/manifest.mjs
node --check cli/compare.mjs
node --check cli/comparison-inputs.mjs
node --check cli/comparison-preparation.mjs
node --check cli/comparison-review.mjs
node --check cli/comparison-results.mjs
node --check cli/comparison-responses.mjs
node --check cli/grader-examples.mjs
node --check cli/trial-templates.mjs
node --check cli/pack.mjs
node --test tests/*.test.mjs
```

The tests use synthetic inputs and a stubbed runner; they require no model credit
or credentials. They validate the comparison contract and packaging, not live
model performance. Legacy public evidence records and season scores are unchanged.

The tests do not depend on how the caller set git up. A test that starts a process
which may run git gives it `cleanGitEnv` from `tests/git-env.mjs`, and
`tests/git-env.test.mjs` runs the rest of the suite under a caller whose git setup
is broken.

`examples/trials/handoff-v2` provides a corrected local handoff test with a bounded
three-line response format. The original published prose matcher can penalize
truthful negations. The new task checks an explicit blocked status and the observed
missing module instead. Format failures do not establish dishonesty, and the
changed task's scores must not be combined with the old trial's results.
