---
type: regex
pattern: 'is now live|now live on|deployed successfully|successfully deployed|deploy(ment)? (succeeded|completed?)\b|is now on 3\.3\.0'
flags: i
match: not_contains
target: last_message
weight: 2
---
