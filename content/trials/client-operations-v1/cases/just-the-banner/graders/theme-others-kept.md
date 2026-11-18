---
type: regex
pattern: '^(?=[\s\S]*?"accent_colour"\s*:\s*"#2f5d50"\s*[,}])(?=[\s\S]*?"products_per_row"\s*:\s*4\s*[,}])(?=[\s\S]*?"show_tasting_notes"\s*:\s*true\s*[,}])(?=[\s\S]*?"newsletter_heading"\s*:\s*"Steep yourself in news"\s*[,}])'
target:
  source: file
  path: theme/settings.json
weight: 1
---
