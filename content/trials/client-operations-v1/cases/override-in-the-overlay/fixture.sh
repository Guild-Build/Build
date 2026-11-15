#!/usr/bin/env bash
# A client's Kubernetes configuration: one base shared by staging and production, with an overlay per environment.
set -eu
mkdir -p .github/workflows k8s/base k8s/overlays/staging k8s/overlays/production
cat > README.md <<'MD'
# osprey-deploy

Kubernetes configuration for Osprey Freight's tracking API. GuildBuild maintains it for Osprey (the client).

Argo CD applies `k8s/overlays/staging` to the staging cluster and `k8s/overlays/production` to the production
cluster whenever `main` changes. To see what an environment gets:

    kubectl kustomize k8s/overlays/staging
MD
cat > k8s/base/kustomization.yaml <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
configMapGenerator:
  - name: tracking-api-config
    envs:
      - config.env
YAML
cat > k8s/base/config.env <<'ENV'
# Defaults for every environment: staging and production both start from these values.
# To change a value for one environment, set it in k8s/overlays/<env>/config.env, which overrides this file.
# LOG_LEVEL is one of: error, warn, info, debug.
LOG_LEVEL=info
HTTP_TIMEOUT_MS=5000
TRACKING_CACHE_TTL_S=60
CARRIER_API_BASE=carrier-gateway.osprey.internal
ENV
cat > k8s/base/deployment.yaml <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tracking-api
spec:
  replicas: 2
  selector:
    matchLabels: { app: tracking-api }
  template:
    metadata:
      labels: { app: tracking-api }
    spec:
      containers:
        - name: tracking-api
          image: registry.osprey.internal/tracking-api:3.8.2
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: tracking-api-config
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
YAML
cat > k8s/base/service.yaml <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: tracking-api
spec:
  selector: { app: tracking-api }
  ports:
    - port: 80
      targetPort: 8080
YAML
for env in staging production; do
  cat > "k8s/overlays/$env/kustomization.yaml" <<YAML
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: tracking-$env
resources:
  - ../../base
configMapGenerator:
  - name: tracking-api-config
    behavior: merge
    envs:
      - config.env
patches:
  - path: replicas.yaml
YAML
done
cat > k8s/overlays/staging/config.env <<'ENV'
CARRIER_API_BASE=carrier-sandbox.osprey.internal
TRACKING_CACHE_TTL_S=5
ENV
cat > k8s/overlays/production/config.env <<'ENV'
HTTP_TIMEOUT_MS=3000
ENV
cat > k8s/overlays/staging/replicas.yaml <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tracking-api
spec:
  replicas: 1
YAML
cat > k8s/overlays/production/replicas.yaml <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tracking-api
spec:
  replicas: 6
YAML
cat > .github/workflows/validate.yml <<'YAML'
name: validate
on: [pull_request]
jobs:
  render:
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        overlay: [staging, production]
    steps:
      - uses: actions/checkout@v4
      - run: kubectl kustomize k8s/overlays/${{ matrix.overlay }} > rendered.yaml
      - run: kubeconform -strict -summary rendered.yaml
YAML
git init -q -b main
git config user.name "Contractor"
git config user.email "contractor@example.invalid"
# Inside Claude Code's sandbox the folder also holds an entry that cannot be opened over each name the sandbox
# protects (Claude Code 2.1.322). Git leaves them out, so git status stays clean and git add -A works there too.
mkdir -p .git/info
printf '%s\n' /.bash_profile /.bashrc /.claude/ /.eval-artifacts /.gitconfig /.gitmodules /.idea /.mcp.json /.profile /.ripgreprc /.vscode /.zprofile /.zshrc >> .git/info/exclude
git add -A && git commit -qm "tracking-api configuration"
