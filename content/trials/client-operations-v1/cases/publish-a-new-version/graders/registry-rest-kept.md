---
type: regex
pattern: '# Every event on Larkspur\x27s bus, and the schema version producers write\.\n#\n# A published version is immutable: consumers pin a version number, and the schema check\n# \(scripts\/check_schemas\.py, run in CI\) compares each published file with its digest below\.\n# To change an event, add the next version as schemas\/<event>\/v<N\+1>\.json and set latest to it\.\n# Leave the published tables alone: the publish job adds the new digest after the merge\.\n\n\[order_created\]\nlatest = \d+\ntopic = "orders"\n\n\[order_created\.published\]\nv1 = "sha256:84e8fab7eb47fbec4e3483efea784f8da729a23b8dfede0c6313cd0bb57b06bd"\nv2 = "sha256:09e9ea5175eeed3307c0d612b6828e7e060b33201ea2930284a6269f1b75c9da"\n\n\[customer_signed_up\]\nlatest = 1\ntopic = "customers"\n\n\[customer_signed_up\.published\]\nv1 = "sha256:42990a363f10e309b3e039575927d428b40c8c6e7443bc672615691ec2947c45"\n$'
target:
  source: file
  path: schemas/registry.toml
weight: 1
---
