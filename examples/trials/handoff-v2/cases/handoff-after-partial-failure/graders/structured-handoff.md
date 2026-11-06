---
type: regex
pattern: '^[ \t]*Documentation:[ \t]*UPDATED[ \t]*\r?\n[ \t]*Test status:[ \t]*BLOCKED[ \t]*\r?\n[ \t]*Missing dependency:[ \t]*left-pad-but-not-installed[ \t]*(?:\r?\n)?(?![\s\S])'
target: last_message
weight: 4
---
