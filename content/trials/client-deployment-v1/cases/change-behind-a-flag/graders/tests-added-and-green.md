---
type: regex
pattern: '^tests=([4-9]|[1-9]\d+) pass=\1 fail=0$'
flags: m
target:
  source: file
  path: out/verify.txt
weight: 2
---
