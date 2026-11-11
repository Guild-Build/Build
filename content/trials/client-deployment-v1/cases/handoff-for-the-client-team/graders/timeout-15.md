---
type: regex
pattern: '"sessionTimeoutMinutes"\s*:\s*15\b'
target:
  source: file
  path: config/app.json
weight: 1
---
