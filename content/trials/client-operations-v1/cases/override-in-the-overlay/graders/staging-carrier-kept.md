---
type: regex
pattern: '^CARRIER_API_BASE=carrier-sandbox\.osprey\.internal\r?$'
flags: m
target:
  source: file
  path: k8s/overlays/staging/config.env
weight: 0.5
---
