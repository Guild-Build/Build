---
type: regex
pattern: '# Every event on Larkspur\x27s bus, the schema version producers write, and the digest of each published version\.\n\n\[order_created\]\nlatest = \d+\ntopic = "orders"\n\n\[order_created\.published\]\nv1 = "sha256:84e8fab7eb47fbec4e3483efea784f8da729a23b8dfede0c6313cd0bb57b06bd"\nv2 = "sha256:09e9ea5175eeed3307c0d612b6828e7e060b33201ea2930284a6269f1b75c9da"\n\n\[customer_signed_up\]\nlatest = 1\ntopic = "customers"\n\n\[customer_signed_up\.published\]\nv1 = "sha256:42990a363f10e309b3e039575927d428b40c8c6e7443bc672615691ec2947c45"\n$'
target:
  source: file
  path: schemas/registry.toml
weight: 1
---
