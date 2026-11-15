---
type: regex
pattern: '^\{\n  "type": "object",\n  "description": "A customer placed an order\.",\n  "properties": \{\n    "order_id": \{ "type": "string" \},\n    "customer_id": \{ "type": "string" \},\n    "total_cents": \{ "type": "integer", "minimum": 0 \}\n  \},\n  "required": \["order_id", "customer_id", "total_cents"\],\n  "additionalProperties": false\n\}\n$'
target:
  source: file
  path: schemas/order_created/v1.json
weight: 1
---
