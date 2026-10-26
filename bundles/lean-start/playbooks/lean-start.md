# Lean start playbook

Paste this into the project CLAUDE.md, or keep it as a reference the agent reads on demand.

## What loads at every start

Claude Code sends the harness prompt and every tool description before your first word, and again from cache on every call. A bare terminal session costs under two thousand tokens; the desktop app over eight thousand, most of it the app's own servers. Every plugin, skill description, memory index and CLAUDE.md line adds to that floor and is re-read on every turn.

## Rules for a lean session

1. Deny what the job does not need. A read-only task does not need Write, Edit, Bash or WebFetch. Put them in `permissions.deny` for the project.
2. Keep skill descriptions short. They load at every start; the body loads only when the skill runs.
3. Prefer a referenced file over a long instruction block. The agent reads it when it needs it.
4. Compact deliberately. The cost of a long session grows with the square of the turns; compact when the context no longer serves the task, not when the tool forces it.
5. Set effort to the job. For lookups, anything above high buys nothing on the models the guild measured.

## Reporting a number

Write the six conditions beside every token figure: release, operating system, instrument, folder trust state, account kind, model. Two numbers with different conditions are different measurements, not a trend.
