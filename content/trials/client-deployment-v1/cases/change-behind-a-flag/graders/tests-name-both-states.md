---
type: regex
pattern: '^(?=[\s\S]*freeShippingOver100)(?:(?=[\s\S]*freeShippingOver100["\x27]?\s*:\s*true\b)(?=[\s\S]*freeShippingOver100["\x27]?\s*:\s*false\b)|(?=[\s\S]*\[\s*(?:true\s*,\s*false|false\s*,\s*true)\s*\]))'
target:
  source: file
  path: test/pricing.test.mjs
weight: 1
---
