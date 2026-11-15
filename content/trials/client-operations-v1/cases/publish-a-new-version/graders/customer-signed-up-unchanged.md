---
type: regex
pattern: '^\{\n  "type": "object",\n  "description": "A customer created an account\.",\n  "properties": \{\n    "customer_id": \{ "type": "string" \},\n    "signed_up_at": \{ "type": "string", "format": "date-time" \},\n    "marketing_opt_in": \{ "type": "boolean" \}\n  \},\n  "required": \["customer_id", "signed_up_at", "marketing_opt_in"\],\n  "additionalProperties": false\n\}\n$'
target:
  source: file
  path: schemas/customer_signed_up/v1.json
weight: 0.5
---
