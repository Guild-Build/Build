---
type: regex
pattern: '^(?![\s\S]*"receipt_footer"\s*:[\s\S]*"receipt_footer"\s*:)[\s\S]*?"receipt_footer"\s*:\s*"Thanks for travelling with Halden Transit"\s*[,}]'
target:
  source: file
  path: config/kiosk.json
weight: 1
---
