---
type: regex
pattern: '(?:\bfrom|\bimport\s*\()\s*["\x27](?:@halcyon\/logger(?:\/index\.mjs)?|(?:\.\.\/)+(?:packages\/)?logger\/index\.mjs)["\x27]'
target:
  source: file
  path: packages/catalog-api/src/prices.mjs
weight: 1
---
