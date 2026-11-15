---
type: regex
pattern: '^apiVersion: kustomize\.config\.k8s\.io\/v1beta1\nkind: Kustomization\nresources:\n  - deployment\.yaml\n  - service\.yaml\nconfigMapGenerator:\n  - name: tracking-api-config\n    envs:\n      - config\.env\n$'
target:
  source: file
  path: k8s/base/kustomization.yaml
weight: 0.5
---
