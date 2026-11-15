---
type: regex
pattern: '^[ \t]*\[[ \t]*(?:customer_signed_up|"customer_signed_up"|\x27customer_signed_up\x27)[ \t]*\][ \t]*(?:#[^\n]*)?\r?$(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:topic|"topic"|\x27topic\x27)[ \t]*=[ \t]*(?:"customers"|\x27customers\x27)[ \t]*(?:#[^\n]*)?\r?$'
flags: m
target:
  source: file
  path: schemas/registry.toml
weight: 0.25
---
