---
type: regex
pattern: '^LOG_LEVEL=debug[ \t]*$'
flags: m
target:
  source: file
  path: k8s/overlays/staging/config.env
weight: 3
---
