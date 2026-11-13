# Runbook First

A build with one hook and nothing else. When a Claude Code session starts in a repository, the hook looks for the
repository's own operating documents and, if it finds any, adds a few lines to the agent's context before the first
prompt: which documents exist, to read the ones that govern the requested change before changing anything, to run the
checks they name, and to say in the reply which it read.

## What it looks for

Only these names, at the repository's top folder (found with `git rev-parse --show-toplevel`, or the session's folder
when it is not a git repository):

- agent instructions: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`
- a runbook: `RUNBOOK.md`, `runbook.md`, `docs/RUNBOOK.md`, `docs/runbook.md`
- a contributing guide: `CONTRIBUTING.md`, `docs/CONTRIBUTING.md`, `.github/CONTRIBUTING.md`
- the README (`README.md`, `README`, `readme.md`, `Readme.md` or `README.markdown`), only when its first 64 KB name
  one of the documents above, or another existing `.md` file whose name starts with `runbook`, `contributing`,
  `agents`, `claude` or `copilot-instructions`; such a file is listed too.

A name counts only when it is a regular file the session can read, is not a symbolic link, and has no symbolic link
among the folders on its path below the top folder; a link is skipped even when it points inside the repository. At
most eight documents are listed, besides the README.

## When it stays silent

When none of those documents exists, it adds nothing. It exits 0 in every case, so it never stops a session: a folder
it cannot open leaves it silent, and a file it cannot read is left out. Its hook entry gives it a five-second timeout.

## What it costs

No tool call and no model call. It runs `git rev-parse` to find the top folder, checks the names above, reads the start
of the README, writes nothing and uses no network.
The text it adds is 200 characters plus the list of names, when a session starts with a source its matcher names
(`startup|clear|compact`). It never exceeds 1,200 characters: when the whole list would be longer, the list keeps the
documents that fit, in order and each name whole, and ends with how many more there are. For example, 264 characters:

```
Operating documents in this repository: docs/RUNBOOK.md (runbook), README.md (points to docs/RUNBOOK.md).
Before you change anything, read the ones that govern the requested change.
Run the checks they name, and say in your reply which of these documents you read.
```

## Module

- `operating-docs-notice` (SessionStart hook): `scripts/operating-docs-notice.sh`, Bash 3.2 or later with `head`,
  `grep` and `tr`, and git when it is installed; it returns the text as `additionalContext`.

Licensed under the Apache License 2.0.
