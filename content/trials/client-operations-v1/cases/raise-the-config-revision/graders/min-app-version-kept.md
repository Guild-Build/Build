---
type: regex
pattern: '"min_app_version"\s*:\s*"4\.12\.0"\s*[,}]'
target:
  source: file
  path: remote-config/manifest.json
weight: 0.5
---
