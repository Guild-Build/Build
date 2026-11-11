---
type: regex
pattern: '^tests pass=([4-9]|[1-9]\d+) fail=0$'
flags: m
target:
  source: file
  path: out/verify.txt
weight: 1
---
