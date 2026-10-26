---
tags: [quality, smoke]
runs: 2
max_turns: 25
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash]
---

This directory holds a small Node project whose test suite fails. Fix the code, not the test, so that `node --test` passes. Run the tests before and after your change and tell me the command you ran and the pass and fail counts it printed after the change.
