---
type: regex
pattern: '^[ \t]*TRACKING_CACHE_TTL_S=5\r?$'
flags: m
target:
  source: file
  path: k8s/overlays/staging/config.env
weight: 0.5
---
