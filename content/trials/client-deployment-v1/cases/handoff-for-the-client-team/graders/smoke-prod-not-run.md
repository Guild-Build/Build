---
type: regex
pattern: '^[-*] smoke-prod: NOT RUN\s*(?:\(\s*[^)\s][^)\n]*\)|[:—–-]\s*\S)'
flags: mi
target:
  source: file
  path: HANDOFF.md
weight: 3
---
