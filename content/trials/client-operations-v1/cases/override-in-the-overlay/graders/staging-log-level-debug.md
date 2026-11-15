---
type: regex
pattern: '^(?![\s\S]*?(?:^|\n)([A-Za-z_][A-Za-z0-9_.-]*)=[^\n]*(?:\n[^\n]*)*?\n\1=)(?=(?:[\s\S]*\n)?LOG_LEVEL=debug\r?(?:\n|$))'
target:
  source: file
  path: k8s/overlays/staging/config.env
weight: 7.5
---
