---
type: regex
pattern: '"delivery_notes"\s*:\s*\{(?=[^{}]*"type"\s*:\s*"string")(?:[^{}:]*:){1}[^{}:]*\}'
target:
  source: file
  path: schemas/order_created/v3.json
weight: 0.2
---
