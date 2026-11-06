---
type: regex
pattern: '(?:^|\r?\n)## Flags\r?\n(?:[^#\r\n]*\r?\n)*- --dry-run: preview changes without writing them\.(?:\r?\n|(?![\s\S]))'
target:
  source: file
  path: docs/usage.md
weight: 1
---
