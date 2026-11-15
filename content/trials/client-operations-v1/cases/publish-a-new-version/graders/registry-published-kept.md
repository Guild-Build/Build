---
type: regex
pattern: '^[ \t]*\[[ \t]*(?:order_created|"order_created"|\x27order_created\x27)[ \t]*\.[ \t]*(?:published|"published"|\x27published\x27)[ \t]*\][ \t]*(?:#[^\n]*)?\r?$(?=(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:v1|"v1"|\x27v1\x27)[ \t]*=[ \t]*(?:"sha256:84e8fab7eb47fbec4e3483efea784f8da729a23b8dfede0c6313cd0bb57b06bd"|\x27sha256:84e8fab7eb47fbec4e3483efea784f8da729a23b8dfede0c6313cd0bb57b06bd\x27)[ \t]*(?:#[^\n]*)?\r?$)(?=(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:v2|"v2"|\x27v2\x27)[ \t]*=[ \t]*(?:"sha256:09e9ea5175eeed3307c0d612b6828e7e060b33201ea2930284a6269f1b75c9da"|\x27sha256:09e9ea5175eeed3307c0d612b6828e7e060b33201ea2930284a6269f1b75c9da\x27)[ \t]*(?:#[^\n]*)?\r?$)(?:\n[ \t]*(?:(?:(?:v1|"v1"|\x27v1\x27)|(?:v2|"v2"|\x27v2\x27))[ \t]*=[ \t]*(?:"[^"\n]*"|\x27[^\x27\n]*\x27|[^\s#]+)[ \t]*)?(?:#[^\n]*)?\r?$)*(?:\n[ \t]*\[|(?![\s\S]))'
flags: m
target:
  source: file
  path: schemas/registry.toml
weight: 0.5
---
