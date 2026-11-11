---
type: regex
pattern: '^\{\s*"requestsPerMinute"\s*:\s*120\s*,\s*"burst"\s*:\s*20\s*,\s*"timeoutMs"\s*:\s*3000\s*\}\s*$'
target:
  source: file
  path: config/limits.json
weight: 2
---
