---
type: regex
pattern: '"total_cents"\s*:\s*\{(?=[^{}]*"type"\s*:\s*"integer")(?=[^{}]*"minimum"\s*:\s*-?0(?:\.0+)?(?:[eE][+]?0+)?(?=[\s,}\]]))(?:[^{}:]*:){2}[^{}:]*\}'
target:
  source: file
  path: schemas/order_created/v3.json
weight: 0.2
---
