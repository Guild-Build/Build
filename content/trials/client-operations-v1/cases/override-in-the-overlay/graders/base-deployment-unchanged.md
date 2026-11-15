---
type: regex
pattern: '^apiVersion: apps\/v1\nkind: Deployment\nmetadata:\n  name: tracking-api\nspec:\n  replicas: 2\n  selector:\n    matchLabels: \{ app: tracking-api \}\n  template:\n    metadata:\n      labels: \{ app: tracking-api \}\n    spec:\n      containers:\n        - name: tracking-api\n          image: registry\.osprey\.internal\/tracking-api:3\.8\.2\n          ports:\n            - containerPort: 8080\n          envFrom:\n            - configMapRef:\n                name: tracking-api-config\n          readinessProbe:\n            httpGet: \{ path: \/healthz, port: 8080 \}\n$'
target:
  source: file
  path: k8s/base/deployment.yaml
weight: 0.5
---
