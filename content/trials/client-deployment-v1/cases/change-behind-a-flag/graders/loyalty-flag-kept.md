---
type: regex
pattern: '"loyaltyDiscount"\s*:\s*true\s*(?:,|\}|$)'
flags: m
target:
  source: file
  path: config/flags.json
weight: 0.5
---
