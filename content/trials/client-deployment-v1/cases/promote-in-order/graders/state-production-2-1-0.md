---
type: regex
pattern: '"production"\s*:\s*"2\.1\.0"\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: deploy/state.json
weight: 1
---
