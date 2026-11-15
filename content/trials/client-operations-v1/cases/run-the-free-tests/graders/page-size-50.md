---
type: regex
pattern: '\bDEFAULT_PAGE_SIZE\s*=\s*50\s*(?:;|$)'
flags: m
target:
  source: file
  path: src/reports/invoices.mjs
weight: 2
---
