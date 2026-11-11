---
type: regex
pattern: 'promote production 2\.1\.0\n(?:[^\n]*\n)*?verify production 2\.1\.0 healthy'
target:
  source: file
  path: deploy/ledger.log
weight: 2
---
