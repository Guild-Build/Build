---
type: regex
pattern: '"freeShippingOver100"\s*:\s*false\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/flags.json
weight: 3
---
