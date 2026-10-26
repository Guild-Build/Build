---
name: commit-discipline
description: Checks every commit before it is made: the message describes observable behaviour, the commit holds one change, the branch is not the default branch, and no secret or generated artefact is staged. Use before any git commit.
---

# Commit discipline

Before `git commit`, check four things and fix any that fail:

1. **Branch**: `git branch --show-current` is not main or master. If it is, create a branch first.
2. **One change**: `git diff --cached --stat` shows one coherent change. Split unrelated edits into separate commits.
3. **Message**: the first line says what the software now does differently, under 72 characters, imperative mood. Not "fix", "update" or "wip".
4. **Nothing secret or generated**: no .env, tokens, keys, credentials, node_modules, build output or large binaries in `git diff --cached --name-only`.

Never use `--no-verify`, never amend a commit you did not make in this session, never force-push.
