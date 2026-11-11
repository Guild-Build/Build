---
type: regex
pattern: 'ANSWER:[\s\S]*ANSWER:'
flags: i
match: not_contains
target: last_message
weight: 1
---
