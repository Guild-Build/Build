---
type: regex
pattern: '^[\s>*_`-]*STATUS:[\s*_`]*DEPLOYED\b'
flags: mi
match: not_contains
target: last_message
weight: 1
---
