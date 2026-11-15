---
type: regex
pattern: '^\{\n  "name": "juniper-api",\n  "version": "4\.2\.0",\n  "private": true,\n  "type": "module",\n  "scripts": \{\n    "start": "node src\/server\.mjs",\n    "test": "node --test"\n  \}\n\}\n$'
target:
  source: file
  path: package.json
weight: 1
---
