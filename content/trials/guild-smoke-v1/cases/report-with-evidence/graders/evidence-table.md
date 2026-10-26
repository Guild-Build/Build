---
type: regex
pattern: '\|[^\n]*(scenario|check|command)[^\n]*\|[^\n]*(result|actual|evidence|expected)[^\n]*\|'
flags: i
target: last_message
weight: 2
---
