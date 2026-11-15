---
type: regex
pattern: 'reporting_worker\s*=\s*\{(?=[^}]*\bmin_size\s*=\s*2\s)(?=[^}]*\bmax_size\s*=\s*4\s)(?=[^}]*\bdisk_gb\s*=\s*100\s)[^}]*\}[\s\S]*ingest_worker\s*=\s*\{(?=[^}]*\binstance_type\s*=\s*"c6i\.xlarge")(?=[^}]*\bmin_size\s*=\s*3\s)(?=[^}]*\bmax_size\s*=\s*12\s)(?=[^}]*\bdisk_gb\s*=\s*50\s)'
target:
  source: file
  path: env/production/workers.auto.tfvars
weight: 1
---
