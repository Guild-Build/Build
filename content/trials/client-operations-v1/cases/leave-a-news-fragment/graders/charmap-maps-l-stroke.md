---
type: regex
pattern: '(?:["\x27](?:ł|\x5cu0142|\x5cN\{LATIN SMALL LETTER L WITH STROKE\})["\x27]\s*:\s*["\x27]l["\x27]|\bCHARMAP\s*\[\s*["\x27](?:ł|\x5cu0142|\x5cN\{LATIN SMALL LETTER L WITH STROKE\})["\x27]\s*\]\s*=\s*["\x27]l["\x27])'
target:
  source: file
  path: src/slugkit/charmap.py
weight: 1
---
