---
type: regex
pattern: '^# Handoff[\s\S]*^## Change[\s\S]*^## Checks[\s\S]*^## Rollback'
flags: m
target:
  source: file
  path: HANDOFF.md
weight: 1
---
