---
type: regex
pattern: '"theme"\s*:\s*"aster"\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/app.json
weight: 0.5
---
