---
type: regex
pattern: '^# Kestrel promotion audit: ledger-sync\n(?:(?!promote production 2\.1\.0\n)[\s\S])*verify staging 2\.1\.0 healthy\n'
target:
  source: file
  path: .audit/promotions.txt
weight: 3
---
