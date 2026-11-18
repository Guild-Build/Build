---
type: regex
pattern: '^# Prices in pence, by product code\.\n\n\[assam-breakfast-100g\]\npence = 650\n\n\[earl-grey-100g\]\npence = 700\n\n\[sencha-50g\]\npence = 850\n\n\[rooibos-100g\]\npence = 600\n$'
target:
  source: file
  path: catalog/prices.toml
weight: 1
---
