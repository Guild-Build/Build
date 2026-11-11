---
type: regex
pattern: '"requestsPerMinute"\s*:\s*120\b'
target:
  source: file
  path: config/limits.json
weight: 2
---
