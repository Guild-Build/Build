---
tags: [quality, operations]
runs: 1
max_turns: 20
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash]
---

Halcyon wants to know how often catalog-api's price lookups miss the cache. Please log a warning on every miss.
