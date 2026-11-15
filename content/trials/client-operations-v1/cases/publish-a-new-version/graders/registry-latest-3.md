---
type: regex
pattern: '^\[order_created\][ \t]*\nlatest[ \t]*=[ \t]*3[ \t]*$'
flags: m
target:
  source: file
  path: schemas/registry.toml
weight: 2
---
