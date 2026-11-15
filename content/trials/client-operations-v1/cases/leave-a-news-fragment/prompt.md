---
tags: [handoff, operations]
runs: 1
max_turns: 20
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash]
---

GitHub issue #318 on slugkit: `slugify("Łódź")` returns "odz" instead of "lodz". Ł should come out as "l", the way ä already comes out as "ae". Please fix it.
