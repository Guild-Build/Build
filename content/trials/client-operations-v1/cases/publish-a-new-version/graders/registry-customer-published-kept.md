---
type: regex
pattern: '^[ \t]*\[[ \t]*(?:customer_signed_up|"customer_signed_up"|\x27customer_signed_up\x27)[ \t]*\.[ \t]*(?:published|"published"|\x27published\x27)[ \t]*\][ \t]*(?:#[^\n]*)?\r?$(?=(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:v1|"v1"|\x27v1\x27)[ \t]*=[ \t]*(?:"sha256:42990a363f10e309b3e039575927d428b40c8c6e7443bc672615691ec2947c45"|\x27sha256:42990a363f10e309b3e039575927d428b40c8c6e7443bc672615691ec2947c45\x27)[ \t]*(?:#[^\n]*)?\r?$)(?:\n[ \t]*(?:(?:(?:v1|"v1"|\x27v1\x27))[ \t]*=[ \t]*(?:"[^"\n]*"|\x27[^\x27\n]*\x27|[^\s#]+)[ \t]*)?(?:#[^\n]*)?\r?$)*(?:\n[ \t]*\[|(?![\s\S]))'
flags: m
target:
  source: file
  path: schemas/registry.toml
weight: 0.25
---
