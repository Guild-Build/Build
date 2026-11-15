---
type: regex
pattern: '^(?![\s\S]*?(?:^|\n)[ \t]*([A-Za-z_][A-Za-z0-9_.-]*)=[^\n]*(?:\n[^\n]*)*?\n[ \t]*\1=)(?=(?:[\s\S]*\n)?[ \t]*LOG_LEVEL=debug\r?(?:\n|$))'
target:
  source: file
  path: k8s/overlays/staging/config.env
weight: 7.5
---
