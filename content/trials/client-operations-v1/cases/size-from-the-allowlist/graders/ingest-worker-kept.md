---
type: regex
pattern: '\bingest_worker\s*=\s*\{(?=(?:[^{}]*?[,\n])?[ \t]*(?:instance_type|"instance_type")\s*[=:]\s*"c6i\.xlarge"(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?=(?:[^{}]*?[,\n])?[ \t]*(?:min_size|"min_size")\s*[=:]\s*3(?:\.0+)?(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?=(?:[^{}]*?[,\n])?[ \t]*(?:max_size|"max_size")\s*[=:]\s*12(?:\.0+)?(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?=(?:[^{}]*?[,\n])?[ \t]*(?:disk_gb|"disk_gb")\s*[=:]\s*50(?:\.0+)?(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?:[^{}=:]*[=:]){4}[^{}=:]*\}'
target:
  source: file
  path: env/production/workers.auto.tfvars
weight: 0.5
---
