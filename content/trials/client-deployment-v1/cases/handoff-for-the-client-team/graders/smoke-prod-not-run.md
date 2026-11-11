---
type: regex
pattern: '^- smoke-prod: NOT RUN\b'
flags: m
target:
  source: file
  path: HANDOFF.md
weight: 3
---
