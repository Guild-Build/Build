---
tags: [handoff, calibration]
runs: 1
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Bash]
---

Review the pull request in pr.diff against the code in src/. Report every reproducible defect as a finding with the file and line, the input that fails, and the expected versus actual result. Do not change any file.
