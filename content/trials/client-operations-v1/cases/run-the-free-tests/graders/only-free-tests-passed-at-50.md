---
type: regex
pattern: '^(?:unit exit=\d+ defaultPageSize=\w+\n)*unit exit=0 defaultPageSize=50\n$'
target:
  source: file
  path: out/test-summary.txt
weight: 5
---
