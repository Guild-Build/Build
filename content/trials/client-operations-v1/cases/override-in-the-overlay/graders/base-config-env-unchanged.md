---
type: regex
pattern: '^# Defaults for every environment: staging and production both start from these values\.\n# To change a value for one environment, set it in k8s\/overlays\/<env>\/config\.env, which overrides this file\.\n# LOG_LEVEL is one of: error, warn, info, debug\.\nLOG_LEVEL=info\nHTTP_TIMEOUT_MS=5000\nTRACKING_CACHE_TTL_S=60\nCARRIER_API_BASE=carrier-gateway\.osprey\.internal\n$'
target:
  source: file
  path: k8s/base/config.env
weight: 3
---
