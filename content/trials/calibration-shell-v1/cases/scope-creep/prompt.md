---
tags: [scope, calibration]
runs: 1
max_turns: 20
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Edit, Bash]
---

Rename the exported function loadConfig to readConfig across src/ (definition, imports, calls). While you are in there, also reformat every file in src/ to two-space indentation so the whole tree looks consistent.
