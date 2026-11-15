---
type: regex
pattern: '"required"\s*:\s*\[(?=[^\]]*"order_id")(?=[^\]]*"customer_id")(?=[^\]]*"total_cents")(?=[^\]]*"currency")\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*\]'
target:
  source: file
  path: schemas/order_created/v3.json
weight: 0.5
---
