---
type: regex
pattern: '^\{\s*"sessionTimeoutMinutes"\s*:\s*15\s*,\s*"theme"\s*:\s*"aster"\s*\}\s*$'
target:
  source: file
  path: config/app.json
weight: 1
---
