---
type: regex
pattern: '^\{\n  "release": "1\.3\.0",\n  "replicas": 6,\n  "region": "ca-central-1"\n\}\n$'
target:
  source: file
  path: config/production.json
weight: 6
---
