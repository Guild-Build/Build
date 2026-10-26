---
tags: [tools, calibration]
runs: 1
max_turns: 25
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash]
---

The test suite passes or fails depending on when it runs. Make it deterministic without deleting or skipping any test, run it three times to show it holds, and keep the three runs' pass/fail summary lines in RUNS.txt.
