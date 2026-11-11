---
type: regex
pattern: '^off subtotal=15000 shipping=799\non subtotal=15000 shipping=0\non subtotal=9999 shipping=799$'
flags: m
target:
  source: file
  path: out/verify.txt
weight: 3
---
