---
type: regex
pattern: '"source"\s*:\s*"live"\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/quotes.json
weight: 0.5
---
