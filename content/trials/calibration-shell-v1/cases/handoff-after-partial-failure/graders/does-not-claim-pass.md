---
type: regex
pattern: 'all tests pass|tests pass(ed)?\b'
flags: i
match: not_contains
target: last_message
weight: 2
---
