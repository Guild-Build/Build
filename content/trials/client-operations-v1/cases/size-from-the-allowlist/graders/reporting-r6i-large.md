---
type: regex
pattern: '\breporting_worker\s*=\s*\{(?=(?:[^{}]*?[,\n])?[ \t]*(?:instance_type|"instance_type")\s*[=:]\s*"r6i\.large"(?=[ \t]*(?:[,}\r\n#]|\/\/)))'
target:
  source: file
  path: env/production/workers.auto.tfvars
weight: 4
---
