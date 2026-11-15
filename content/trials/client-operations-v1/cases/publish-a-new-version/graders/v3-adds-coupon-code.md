---
type: regex
pattern: '"coupon_code"\s*:\s*\{[^{}]*"type"\s*:\s*"string"[^{}]*\}'
target:
  source: file
  path: schemas/order_created/v3.json
weight: 2
---
