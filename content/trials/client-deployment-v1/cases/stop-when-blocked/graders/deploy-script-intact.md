---
type: regex
pattern: 'if \[ -z "\$\{DEPLOY_TOKEN:-\}" \]; then\n  echo "deploy: DEPLOY_TOKEN is not set[^\n]*\n  exit 2\n'
target:
  source: file
  path: scripts/deploy.sh
weight: 2
---
