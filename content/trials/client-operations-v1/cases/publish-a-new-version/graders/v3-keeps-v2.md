---
type: regex
pattern: '^(?=[\s\S]*"order_id"\s*:\s*\{\s*"type"\s*:\s*"string"\s*\})(?=[\s\S]*"customer_id"\s*:\s*\{\s*"type"\s*:\s*"string"\s*\})(?=[\s\S]*"total_cents"\s*:\s*\{\s*"type"\s*:\s*"integer"\s*,\s*"minimum"\s*:\s*0\s*\})(?=[\s\S]*"currency"\s*:\s*\{\s*"type"\s*:\s*"string"\s*,\s*"enum"\s*:\s*\[\s*"GBP"\s*,\s*"EUR"\s*\]\s*\})(?=[\s\S]*"delivery_notes"\s*:\s*\{\s*"type"\s*:\s*"string"\s*\})(?=[\s\S]*"required"\s*:\s*\[\s*"order_id"\s*,\s*"customer_id"\s*,\s*"total_cents"\s*,\s*"currency"\s*\])(?=[\s\S]*"additionalProperties"\s*:\s*false)'
target:
  source: file
  path: schemas/order_created/v3.json
weight: 1
---
