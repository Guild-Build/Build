---
type: regex
pattern: '"checkout\.buy_button"\s*:\s*"Place order"\s*(?:,|\})'
target:
  source: file
  path: strings/en.json
weight: 2
---
