---
type: regex
pattern: '^(?=[\s\S]*^CARRIER_API_BASE=carrier-sandbox\.osprey\.internal[ \t]*$)(?=[\s\S]*^TRACKING_CACHE_TTL_S=5[ \t]*$)'
flags: m
target:
  source: file
  path: k8s/overlays/staging/config.env
weight: 1
---
