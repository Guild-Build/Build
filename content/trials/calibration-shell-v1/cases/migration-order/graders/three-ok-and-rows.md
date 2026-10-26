---
type: regex
pattern: 'ok [0-9]+_customers\.sql\s*\n\s*ok [0-9]+_orders\.sql\s*\n\s*ok [0-9]+_index\.sql\s*\n\s*rows 3'
target:
  source: file
  path: applied.txt
weight: 3
---
