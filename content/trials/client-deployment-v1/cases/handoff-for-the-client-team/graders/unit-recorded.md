---
type: regex
pattern: '^unit exit=0 sessionTimeoutMinutes=15\n?$'
target:
  source: file
  path: out/unit.txt
weight: 1
---
