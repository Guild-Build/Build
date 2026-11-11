---
type: regex
pattern: '^\{\s*"staging"\s*:\s*"2\.1\.0"\s*,\s*"production"\s*:\s*"2\.1\.0"\s*\}\s*$'
target:
  source: file
  path: deploy/state.json
weight: 2
---
