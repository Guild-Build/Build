---
type: regex
pattern: '^(?![\s\S]*"export_retry_delay"\s*:[\s\S]*"export_retry_delay"\s*:)[\s\S]*?"export_retry_delay"\s*:\s*"2m"\s*[,}]'
target:
  source: file
  path: settings/workers.json
weight: 1
---
