---
type: regex
pattern: '"sessionTimeoutMinutes"\s*:\s*15\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/app.json
weight: 1
---
