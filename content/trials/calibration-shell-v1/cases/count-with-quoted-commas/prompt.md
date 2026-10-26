---
tags: [quality, calibration]
runs: 1
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Write, Bash]
---

orders.csv is a proper CSV (fields may be quoted and contain commas). Count the rows whose status is exactly "failed" and whose amount is greater than 100, and write only that number into ANSWER.txt.
