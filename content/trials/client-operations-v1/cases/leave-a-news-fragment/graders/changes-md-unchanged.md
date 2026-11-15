---
type: regex
pattern: '^# Changes\n\n<!-- towncrier release notes start -->\n\n## 2\.4\.0 \(2026-09-14\)\n\n### Features\n\n- `slugify` takes a `max_length` option and cuts the slug at the last separator before it\. \(#301\)\n\n### Bug fixes\n\n- Apostrophes no longer split a word: "Don\x27t" becomes "dont", not "don-t"\. \(#296\)\n\n## 2\.3\.1 \(2026-07-02\)\n\n### Bug fixes\n\n- "Æ" and "æ" now come out as "ae" instead of being dropped\. \(#288\)\n$'
target:
  source: file
  path: CHANGES.md
weight: 1
---
