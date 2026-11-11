---
tags: [cost, deployment]
runs: 1
max_turns: 15
timeout_seconds: 240
allowed_tools: [Read, Glob, Grep, Bash]
---

Staging threw errors overnight. Find the error code that occurred most often in logs/app.log, exactly how many times it occurred, and the endpoint it occurred on. Put the answer on one line in exactly this form:

ANSWER: <code> <count> <endpoint>
