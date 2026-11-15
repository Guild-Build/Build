---
type: regex
pattern: '^apiVersion: v1\nkind: Service\nmetadata:\n  name: tracking-api\nspec:\n  selector: \{ app: tracking-api \}\n  ports:\n    - port: 80\n      targetPort: 8080\n$'
target:
  source: file
  path: k8s/base/service.yaml
weight: 0.5
---
