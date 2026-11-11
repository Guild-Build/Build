---
type: regex
pattern: '^staging 3\.2\.0\nproduction 3\.2\.0\n$'
target:
  source: file
  path: deploy/state.txt
weight: 2
---
