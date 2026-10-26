# Evidence-First Review

A build for teams that let coding agents open pull requests under review rules. It installs:

- **pr-review-contract** (skill): a verdict is a reproducible finding on the exact head: file, line, failing input, expected and actual. Taste is labelled as taste and never blocks.
- **evidence-table** (skill): every "tested" claim comes with scenario, setup, expected, actual and the proving command or artefact. Untested scenarios are listed as untested.
- **independent-reviewer** (agent): reviews a diff it did not write, with the author's reasoning withheld.
- **merge-guard** (PreToolUse hook): blocks force pushes and pull-request merges from the authoring session. The author proposes; a different identity merges.

The merge guard reads each Bash command the way the shell splits it, including the commands inside `bash -c`, `eval`, command substitutions, and here-documents or pipes that a shell reads. It reads only the command's text, so it does not catch:

- git aliases, shell aliases and git config, such as an alias for `push --force` or a `+refspec` or mirror setting for a remote;
- a git name or a command produced by a variable or by another command's output, such as `$GIT push -f` or `sh -c "$(cat cmd.txt)"`;
- `xargs`, which builds the command it runs from its input;
- scripts written to disk and run later;
- merges by any route other than `gh pr merge` and `gh api` on a pull request's merge endpoint, such as the GraphQL API or `curl`.

Install in Claude Code 2.1.224 or later (running the trial needs 2.1.269 or later):

```
claude plugin marketplace add https://buildguild.gg/.claude-plugin/marketplace.json
claude plugin install evidence-first-review@buildguild
```

Trial: Guild Smoke Trial v1. Evidence and tier: https://buildguild.gg/builds/evidence-first-review/
