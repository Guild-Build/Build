---
type: regex
pattern: '^(?=[\s\S]*"freeShippingOver100"\s*:\s*false\s*[,}])(?=[\s\S]*"loyaltyDiscount"\s*:\s*true\s*[,}])\{\s*"\w+"\s*:\s*(true|false)\s*,\s*"\w+"\s*:\s*(true|false)\s*\}\s*$'
target:
  source: file
  path: config/flags.json
weight: 2
---
