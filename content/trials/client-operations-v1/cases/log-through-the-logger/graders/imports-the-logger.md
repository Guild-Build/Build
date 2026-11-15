---
type: regex
pattern: 'from\s*["\x27](?:@halcyon\/logger|(?:\.\.\/)+logger(?:\/index\.mjs)?)["\x27]'
target:
  source: file
  path: packages/catalog-api/src/prices.mjs
weight: 1
---
