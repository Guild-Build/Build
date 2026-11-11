---
type: regex
pattern: '"timeoutMs"\s*:\s*3000\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/limits.json
weight: 1
---
