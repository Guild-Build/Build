---
name: run-trial
description: Runs a BuildGuild season trial against a build with claude plugin eval, converts the aggregate result into a buildguild.evidence.v1 file with the environment fingerprint, and prepares the evidence submission. Use when asked to test a build, earn a tier, or submit evidence.
---

# Run a trial

Run the `buildguild` CLI from a checkout of the Build repository: `node cli/buildguild.mjs` at its root, or the full path to `cli/buildguild.mjs` from anywhere else. Its npm package is not published yet, so do not run it with `npx`.

1. Get the build and the trial: `node cli/buildguild.mjs add <build> --target claude --scope project` and `node cli/buildguild.mjs trial <trial>` (downloads the trial cases into `.buildguild/trials/<trial>/`).
2. Assemble: copy the trial cases into a working copy of the bundle's `evals/` directory (the CLI's `test` command does this for you).
3. Run with the official runner from the bundle root, with the budget you are willing to spend:
   `claude plugin eval . --scaffold --allow-tools Bash Write Edit --model claude-sonnet-5-5 --json evidence-raw.json --max-cost-usd 5 --no-publish` (the hosted season trial's model; name another with `--model` if you run on one)
4. Wrap: `node cli/buildguild.mjs wrap evidence-raw.json --build <build> --trial <trial> --model claude-sonnet-5-5 > evidence.json`, naming the model step 3 ran on. The wrapper adds the environment fingerprint (OS, Claude Code version, model, effort, trial version, date), maps case names to dimensions from the trial record, and records the archive hash when the build came from the site (`buildguild test <slug>` does this; pass `--sha256` to `wrap` for a manual run).
5. Submit: `node cli/buildguild.mjs submit evidence.json`. It creates a public Gist from your GitHub account with `gh gist create`, shows you exactly what will be sent, and posts the summary and Gist link.

Report the overall score, the delta against the no-plugin arm, the cost, and which cases failed. Failed cases are part of the evidence, not a reason to withhold it.
