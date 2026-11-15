---
type: regex
pattern: '"currency"\s*:\s*\{(?=[^{}]*"type"\s*:\s*"string")(?=[^{}]*"enum"\s*:\s*\[(?=[^\]]*"GBP")(?=[^\]]*"EUR")\s*"[^"]*"\s*,\s*"[^"]*"\s*\])(?:[^{}:]*:){2}[^{}:]*\}'
target:
  source: file
  path: schemas/order_created/v3.json
weight: 0.2
---
