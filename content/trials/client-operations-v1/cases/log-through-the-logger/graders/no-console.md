---
type: regex
pattern: '\bconsole\s*(?:\?\.|\.|\[)'
match: not_contains
target:
  source: file
  path: packages/catalog-api/src/prices.mjs
weight: 3
---
