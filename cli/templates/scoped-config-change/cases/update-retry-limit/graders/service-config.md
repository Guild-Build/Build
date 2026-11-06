---
type: regex
pattern: '^retry_limit=3\r?\ntimeout_seconds=5\r?\n(?![\s\S])'
target:
  source: file
  path: service.conf
weight: 1
---
