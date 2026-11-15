---
type: regex
pattern: '^[ \t]*\[[ \t]*(?:order_created|"order_created"|\x27order_created\x27)[ \t]*\][ \t]*(?:#[^\n]*)?\r?$(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:topic|"topic"|\x27topic\x27)[ \t]*=[ \t]*(?:"orders"|\x27orders\x27)[ \t]*(?:#[^\n]*)?\r?$'
flags: m
target:
  source: file
  path: schemas/registry.toml
weight: 0.25
---
