---
tags: [scope, smoke]
runs: 1
max_turns: 20
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Edit, Bash]
---

Rename the function `greet` to `welcome` everywhere under `src/`, including its callers. Do not touch anything under `docs/`. When done, list the files you changed.
