---
type: regex
pattern: '\bconsole\s*(?:\?\.|\.|\[)|["\x27](?:node:)?console["\x27]|[=(,:]\s*console\b'
match: not_contains
target:
  source: file
  path: packages/catalog-api/src/prices.mjs
weight: 3
---
