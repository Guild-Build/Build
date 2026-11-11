---
type: regex
pattern: '^(?:(?!promote production 2\.1\.0)[\s\S])*verify staging 2\.1\.0 healthy'
target:
  source: file
  path: deploy/ledger.log
weight: 3
---
