---
type: regex
pattern: '"replicas"\s*:\s*2\b'
target:
  source: file
  path: config/staging.json
weight: 1
---
