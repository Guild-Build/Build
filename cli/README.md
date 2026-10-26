# buildguild CLI

The command-line companion to [buildguild.gg](https://buildguild.gg/). Node 22 or later, no dependencies.

Run from a checkout of the Build repository; the `buildguild` npm package is not published yet, so do not run it with `npx`.

```
node cli/buildguild.mjs new build my-desk      # or: new trial my-tasks
node cli/buildguild.mjs check my-desk
node cli/buildguild.mjs publish my-desk
node cli/buildguild.mjs list
node cli/buildguild.mjs show measured-delivery
node cli/buildguild.mjs add measured-delivery --scope project
node cli/buildguild.mjs test measured-delivery --model claude-sonnet-5-5 --max-cost-usd 5
node cli/buildguild.mjs test my-desk --trial ./my-tasks --model claude-sonnet-5-5   # your own trial folder: a local run, not evidence
node cli/buildguild.mjs submit evidence.json
```

`new` scaffolds a build or a trial that already passes `check`. `check` runs the manifest, skill, hook, grader front-matter and fixture checks (and `claude plugin validate --strict` when Claude Code is installed); it catches the authoring mistakes the eval runner skips silently. For a trial it also refuses symlinks under `cases/`, which a published archive cannot carry, and it reports a fixture that names a network tool without running it. `publish` runs `check`, shows exactly what will be sent, asks for the rights and naming consents, and posts the submission.

`add` downloads the build's archive from the site, verifies its SHA-256 against the build record, unpacks it under `.claude/plugins/buildguild/<slug>/` (and `.agents/skills/` with `--target codex` or `all`), and records every file in `.buildguild/lock.json` so `remove` reverses it exactly, emptied folders included. It refuses, before writing anything, to overwrite a file under `.agents/` that the lock does not record for that build, such as a skill of your own.

`test` downloads a published trial's cases (`--trial <slug>`, default `guild-smoke-v1`), copies them into the bundle's `evals/`, runs `claude plugin eval` on the model you name with `--model` (required; `ANTHROPIC_MODEL` may stand in for it) and the cost cap you give, and wraps the report into a `buildguild.evidence.v1` file with the environment fingerprint.

`--trial <path>` runs a trial folder of your own instead, such as one made by `new trial`. A value that starts with `.` or holds a slash is a path; a bare name is a folder only when it holds `trial.json`, so an unrelated folder never hides a published slug. `test` first runs the trial checks `check` runs and stops on any problem, before it looks for Claude Code or downloads anything, then writes the folder's `cases/` into `evals/` the way a published trial is unpacked: the same layout, `.sh` files executable and the rest not. The run is for you, the author: it is written to `local-run.json`, marked `"trialSource": "local"` with the slug and version from the folder's `trial.json`, and `submit` refuses it. The raw report (`--raw-out`) carries the same marker, and `wrap` refuses a marked report for a published slug. Evidence comes only from a run on a published trial. `wrap --trial <path>` marks its record the same way.

`--work-dir <dir>` is deleted before the run, so `test` refuses, before deleting anything, one that is the filesystem root, your home directory, the current directory or one of its ancestors, or the build or trial folder, a folder inside either (one not created yet included), or a folder that holds either.

`submit` publishes that file as a public Gist from your own GitHub account (`gh gist create`) after showing you exactly what will be sent, then posts the summary and the Gist link to the guild. It refuses a record marked local before it calls `gh`, so no Gist is made.

`check` uses the same build manifest rules as the planner and draft API. Build manifests include name, summary and licence as well as profiles and modules; each profile has a one-line limits statement of at least ten characters. Private checks and exports do not require listing consent. The internal `bundles/bare-runtime` trial control intentionally has no modules and uses the baseline category; it is not an authorable build and does not pass these checks.

`npm pack` stages the CLI and the shared validator together without adding dependencies.
