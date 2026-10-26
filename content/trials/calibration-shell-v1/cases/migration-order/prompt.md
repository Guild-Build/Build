---
tags: [quality, calibration]
runs: 1
max_turns: 25
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash]
---

`python3 apply.py` applies the SQL files under migrations/ in name order against a fresh SQLite database and fails. Make it succeed without changing apply.py or deleting any migration, then run it and keep its output in applied.txt.
