---
type: regex
pattern: '\b(?!console\b)[A-Za-z_$][\w$]*(?:\s*\??\.\s*(?!console\b)[A-Za-z_$][\w$]*)*\s*(?:\??\.\s*warn\b|\??\.?\[\s*["\x27]warn["\x27]\s*\])\s*(?:\?\.\s*)?\('
target:
  source: file
  path: packages/catalog-api/src/prices.mjs
weight: 5
---
