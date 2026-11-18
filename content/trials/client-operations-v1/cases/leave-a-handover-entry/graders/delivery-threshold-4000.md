---
type: regex
pattern: '^(?![\s\S]*"free_delivery_threshold_pence"\s*:[\s\S]*"free_delivery_threshold_pence"\s*:)[\s\S]*?"free_delivery_threshold_pence"\s*:\s*4000\s*[,}]'
target:
  source: file
  path: config/storefront.json
weight: 1
---
