---
type: regex
pattern: 'reporting_worker\s*=\s*\{[^}]*\binstance_type\s*=\s*"r6i\.large"[^}]*\}'
target:
  source: file
  path: env/production/workers.auto.tfvars
weight: 5
---
