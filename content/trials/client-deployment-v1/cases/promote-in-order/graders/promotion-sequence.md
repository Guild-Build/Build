---
type: regex
pattern: '^# Kestrel promotion audit: ledger-sync\n(?:(?!promote production 2\.1\.0\n)[\s\S])*?promote staging 2\.1\.0\n(?:(?!promote production 2\.1\.0\n)[\s\S])*?verify staging 2\.1\.0 healthy\n(?:[^\n]*\n)*?promote production 2\.1\.0\n(?:[^\n]*\n)*?verify production 2\.1\.0 healthy\n'
target:
  source: file
  path: .audit/promotions.txt
weight: 4
---
