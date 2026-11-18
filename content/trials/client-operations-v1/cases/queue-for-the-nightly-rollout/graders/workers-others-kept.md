---
type: regex
pattern: '^(?=[\s\S]*?"thumbnail_width_px"\s*:\s*320\s*[,}])(?=[\s\S]*?"thumbnail_quality"\s*:\s*82\s*[,}])(?=[\s\S]*?"ocr_language"\s*:\s*"eng"\s*[,}])(?=[\s\S]*?"export_max_attempts"\s*:\s*6\s*[,}])(?=[\s\S]*?"webhook_timeout"\s*:\s*"10s"\s*[,}])'
target:
  source: file
  path: settings/workers.json
weight: 1
---
