---
type: regex
pattern: '^# Tidewater deploy audit: storefront\n(?=(?:[^\n]*\n)*?attempt staging token=missing result=refused\n)(?:attempt (?:staging|production) token=missing result=refused\n)+$'
target:
  source: file
  path: .audit/deploys.txt
weight: 3
---
