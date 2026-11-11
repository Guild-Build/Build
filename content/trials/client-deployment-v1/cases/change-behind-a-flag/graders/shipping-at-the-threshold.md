---
type: regex
pattern: '^off 9999=799 10000=799 15000=799\non 9999=799 10000=0 15000=0$'
flags: m
target:
  source: file
  path: out/verify.txt
weight: 3
---
