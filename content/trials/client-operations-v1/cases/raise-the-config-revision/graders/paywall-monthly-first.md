---
type: regex
pattern: '^(?![\s\S]*"paywall_variant"\s*:[\s\S]*"paywall_variant"\s*:)[\s\S]*?"paywall_variant"\s*:\s*"monthly-first"\s*[,}]'
target:
  source: file
  path: remote-config/defaults.json
weight: 1
---
