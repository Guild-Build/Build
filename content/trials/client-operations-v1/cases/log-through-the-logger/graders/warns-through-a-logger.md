---
type: regex
pattern: '\b(?!console\b)[A-Za-z_][\w$]*\s*\.warn\s*\('
target:
  source: file
  path: packages/catalog-api/src/prices.mjs
weight: 1
---
