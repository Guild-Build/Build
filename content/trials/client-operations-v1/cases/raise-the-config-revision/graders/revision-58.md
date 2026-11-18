---
type: regex
pattern: '^(?![\s\S]*"revision"\s*:[\s\S]*"revision"\s*:)[\s\S]*?"revision"\s*:\s*58\s*[,}]'
target:
  source: file
  path: remote-config/manifest.json
weight: 2.5
---
