---
type: regex
pattern: '"timeoutMs"\s*:\s*3000\b'
target:
  source: file
  path: config/limits.json
weight: 1
---
