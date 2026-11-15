---
type: regex
pattern: '^reporting_worker = \{\n  instance_type = "t3\.medium"\n  min_size      = 1\n  max_size      = 2\n  disk_gb       = 50\n\}\n\ningest_worker = \{\n  instance_type = "t3\.medium"\n  min_size      = 1\n  max_size      = 3\n  disk_gb       = 30\n\}\n$'
target:
  source: file
  path: env/staging/workers.auto.tfvars
weight: 1
---
