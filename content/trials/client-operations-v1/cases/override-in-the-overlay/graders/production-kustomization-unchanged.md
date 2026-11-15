---
type: regex
pattern: '^apiVersion: kustomize\.config\.k8s\.io\/v1beta1\nkind: Kustomization\nnamespace: tracking-production\nresources:\n  - \.\.\/\.\.\/base\nconfigMapGenerator:\n  - name: tracking-api-config\n    behavior: merge\n    envs:\n      - config\.env\npatches:\n  - path: replicas\.yaml\n$'
target:
  source: file
  path: k8s/overlays/production/kustomization.yaml
weight: 0.5
---
