---
type: regex
pattern: '^[ \t]*\[[ \t]*(?:order_created|"order_created"|\x27order_created\x27)[ \t]*\][ \t]*(?:#[^\n]*)?\r?$(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:latest|"latest"|\x27latest\x27)[ \t]*=[ \t]*\+?3[ \t]*(?:#[^\n]*)?\r?$'
flags: m
target:
  source: file
  path: schemas/registry.toml
weight: 2
---
