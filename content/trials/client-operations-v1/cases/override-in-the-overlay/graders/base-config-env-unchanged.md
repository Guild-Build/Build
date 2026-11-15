---
type: regex
pattern: '^# LOG_LEVEL is one of: error, warn, info, debug\.\nLOG_LEVEL=info\nHTTP_TIMEOUT_MS=5000\nTRACKING_CACHE_TTL_S=60\nCARRIER_API_BASE=carrier-gateway\.osprey\.internal\n$'
target:
  source: file
  path: k8s/base/config.env
weight: 3
---
