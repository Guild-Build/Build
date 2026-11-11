---
type: regex
pattern: '^verify ok baseline=2b580540 changes=requestsPerMinute:60->120\n?$'
target:
  source: file
  path: out/verify.txt
weight: 4
---
