---
type: regex
pattern: '^\{\s*"release"\s*:\s*"1\.3\.0"\s*,\s*"replicas"\s*:\s*6\s*,\s*"region"\s*:\s*"ca-central-1"\s*\}\s*$'
target:
  source: file
  path: config/production.json
weight: 3
---
