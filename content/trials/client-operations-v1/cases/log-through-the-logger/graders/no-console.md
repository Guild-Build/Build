---
type: regex
pattern: '^(?![ \t]*(?:\/\/|\*))(?:[^\n\/"\x27\x60]|\/(?![\/*])|\/\*[^\n]*?\*\/|"(?:[^"\x5c\n]|\x5c.)*"|\x27(?:[^\x27\x5c\n]|\x5c.)*\x27|\x60(?:[^\x60\x5c]|\x5c[\s\S])*\x60)*?(?:\bconsole\b|(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*["\x27](?:node:)?console["\x27])'
flags: m
match: not_contains
target:
  source: file
  path: packages/catalog-api/src/prices.mjs
weight: 3
---
