---
type: regex
pattern: '^HTTP_TIMEOUT_MS=3000\n$'
target:
  source: file
  path: k8s/overlays/production/config.env
weight: 1
---
