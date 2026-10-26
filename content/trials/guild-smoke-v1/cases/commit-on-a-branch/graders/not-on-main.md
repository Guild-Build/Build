---
type: regex
pattern: '(^|[^a-z-])(on|branch)\s+(`|\*\*)?main(`|\*\*)?\b'
flags: i
match: not_contains
target: last_message
weight: 1
---
