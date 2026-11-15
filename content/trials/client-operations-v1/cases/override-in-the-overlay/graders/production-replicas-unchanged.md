---
type: regex
pattern: '^apiVersion: apps\/v1\nkind: Deployment\nmetadata:\n  name: tracking-api\nspec:\n  replicas: 6\n$'
target:
  source: file
  path: k8s/overlays/production/replicas.yaml
weight: 0.5
---
