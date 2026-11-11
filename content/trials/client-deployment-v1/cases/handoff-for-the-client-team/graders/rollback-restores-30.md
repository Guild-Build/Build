---
type: regex
pattern: '^## Rollback[ \t]*\r?\n(?:(?!^#)[\s\S])*?\b30\b'
flags: mi
target:
  source: file
  path: HANDOFF.md
weight: 2
---
