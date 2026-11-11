---
type: regex
pattern: '"replicas"\s*:\s*2\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/staging.json
weight: 0.5
---
