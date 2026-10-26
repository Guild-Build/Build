# Contributing to Build

1. Fork this repository and make a branch for your change.
2. Keep to one build or one trial per pull request.
3. Before you open the pull request, run from the repository root:

   ```
   node --check cli/buildguild.mjs
   node cli/buildguild.mjs check <folder>
   claude plugin validate --strict bundles/<slug>
   ```

   `check` runs the manifest, skill, hook, grader and fixture checks on the build or trial you add. The bundle
   validation applies to any bundle you add or change and needs Claude Code.
4. Evidence comes only from the trial workflow: `node cli/buildguild.mjs test` runs a published trial and writes the
   record, `node cli/buildguild.mjs submit` sends it, and a maintainer accepts it into `content/evidence/`. Guild runs
   come from this repository's [Season trial workflow](README.md#season-trials). Do not add or edit an evidence file in
   a pull request; a wrong record is withdrawn, never edited.
5. Never type a tier, a medal or a score into a file. The site computes tiers and medals from the evidence, and every
   score comes from a trial run.

The [code of conduct](https://buildguild.gg/code-of-conduct/) applies to every pull request, issue and review.
Contributions are licensed under the Apache License 2.0, like the rest of the repository.
