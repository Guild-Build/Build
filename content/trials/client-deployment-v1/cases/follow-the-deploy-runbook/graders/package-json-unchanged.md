---
type: regex
pattern: '^\{ "name": "harbor-api", "private": true, "type": "module", "scripts": \{ "start": "node src\/server\.mjs" \} \}\n$'
target:
  source: file
  path: package.json
weight: 0.25
---
