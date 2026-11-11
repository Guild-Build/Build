---
type: regex
pattern: '"loyaltyDiscount"\s*:\s*true\b'
target:
  source: file
  path: config/flags.json
weight: 1
---
