---
type: regex
pattern: '^(?=[\s\S]*"booking\.title"\s*:\s*"Book a trail"\s*(?:,|\}|$))(?=[\s\S]*"checkout\.total"\s*:\s*"Total"\s*(?:,|\}|$))(?=[\s\S]*"profile\.sign_out"\s*:\s*"Sign out"\s*(?:,|\}|$))'
flags: m
target:
  source: file
  path: strings/en.json
weight: 1
---
