---
type: regex
pattern: '"region"\s*:\s*"ca-central-1"\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/staging.json
weight: 0.5
---
