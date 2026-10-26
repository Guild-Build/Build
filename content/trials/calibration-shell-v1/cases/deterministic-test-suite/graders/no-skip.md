---
type: regex
pattern: 'skip|todo|only'
match: not_contains
target:
  source: file
  path: test/greeting.test.mjs
weight: 1
---
