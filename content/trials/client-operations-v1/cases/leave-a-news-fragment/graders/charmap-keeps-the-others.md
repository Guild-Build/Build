---
type: regex
pattern: '^(?=[\s\S]*["\x27]ä["\x27]\s*:\s*["\x27]ae["\x27])(?=[\s\S]*["\x27]ö["\x27]\s*:\s*["\x27]oe["\x27])(?=[\s\S]*["\x27]ü["\x27]\s*:\s*["\x27]ue["\x27])(?=[\s\S]*["\x27]æ["\x27]\s*:\s*["\x27]ae["\x27])(?=[\s\S]*["\x27]ø["\x27]\s*:\s*["\x27]oe["\x27])(?=[\s\S]*["\x27]đ["\x27]\s*:\s*["\x27]d["\x27])'
target:
  source: file
  path: src/slugkit/charmap.py
weight: 0.5
---
