---
type: regex
pattern: '"requestsPerMinute"\s*:\s*120\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/limits.json
weight: 1
---
