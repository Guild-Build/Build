---
type: regex
pattern: '^# Price notices waiting to be sent, written by scripts\/price_notice\.py\.\nsencha-50g: 800 -> 850 pence\n$'
target:
  source: file
  path: notices/pending.txt
weight: 1
---
