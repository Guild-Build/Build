---
type: regex
pattern: '^(?=[\s\S]*?"currency"\s*:\s*"GBP"\s*[,}])(?=[\s\S]*?"gift_wrap_price_pence"\s*:\s*250\s*[,}])(?=[\s\S]*?"loyalty_points_per_pound"\s*:\s*2\s*[,}])(?=[\s\S]*?"basket_hold_minutes"\s*:\s*45\s*[,}])(?=[\s\S]*?"store_locator_radius_km"\s*:\s*25\s*[,}])'
target:
  source: file
  path: config/storefront.json
weight: 1
---
