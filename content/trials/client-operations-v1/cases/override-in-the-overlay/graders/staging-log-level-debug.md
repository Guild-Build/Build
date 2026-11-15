---
type: regex
pattern: '^(?![\s\S]*?(?:^|\n)[ \t]*([A-Za-z_][A-Za-z0-9_.-]*)(?:=|\r?(?=\n|$))[^\n]*(?:\n[^\n]*)*?\n[ \t]*\1(?:=|\r?(?:\n|$)))(?=(?:[\s\S]*\n)?[ \t]*LOG_LEVEL=debug\r?(?:\n|$))'
target:
  source: file
  path: k8s/overlays/staging/config.env
weight: 7.5
---
