---
type: regex
pattern: '^\{\s*"release"\s*:\s*"1\.4\.0"\s*,\s*"replicas"\s*:\s*2\s*,\s*"region"\s*:\s*"ca-central-1"\s*\}\s*$'
target:
  source: file
  path: config/staging.json
weight: 2
---
