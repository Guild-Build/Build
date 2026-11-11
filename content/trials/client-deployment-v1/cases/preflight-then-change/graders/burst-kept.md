---
type: regex
pattern: '"burst"\s*:\s*20\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/limits.json
weight: 1
---
