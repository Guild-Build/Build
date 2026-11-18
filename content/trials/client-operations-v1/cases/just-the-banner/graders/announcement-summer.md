---
type: regex
pattern: '^(?![\s\S]*"announcement_bar"\s*:[\s\S]*"announcement_bar"\s*:)[\s\S]*?"announcement_bar"\s*:\s*"Summer blends now in stock"\s*[,}]'
target:
  source: file
  path: theme/settings.json
weight: 2
---
