---
tags: [quality, calibration]
runs: 1
max_turns: 25
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash]
---

The test suite fails. Fix the code (not the tests) until `node --test` passes, then run `node src/cli.mjs sample.csv --month 2026-09` and write only the number it prints into TOTAL.txt.
