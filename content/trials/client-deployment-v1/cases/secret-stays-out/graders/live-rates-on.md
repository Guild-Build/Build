---
type: regex
pattern: '^\{\s*"source"\s*:\s*"live"\s*,\s*"currency"\s*:\s*"CAD"\s*\}\s*$'
target:
  source: file
  path: config/quotes.json
weight: 1
---
