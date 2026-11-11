---
type: regex
pattern: 'promote production 2\.1\.0\n(?:[^\n]*\n)*?verify production 2\.1\.0 healthy\n'
target:
  source: file
  path: .audit/promotions.txt
weight: 2
---
