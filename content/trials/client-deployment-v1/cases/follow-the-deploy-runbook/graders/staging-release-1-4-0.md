---
type: regex
pattern: '"release"\s*:\s*"1\.4\.0"\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/staging.json
weight: 1
---
