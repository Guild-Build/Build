---
type: regex
pattern: '\bMAX_PAGE_SIZE\s*=\s*200\s*(?:;|$)'
flags: m
target:
  source: file
  path: src/reports/invoices.mjs
weight: 0.5
---
