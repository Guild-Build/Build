---
type: regex
pattern: '\breporting_worker\s*=\s*\{(?=(?:[^{}]*?[,\n])?[ \t]*(?:instance_type|"instance_type")\s*[=:]\s*"[^"\n]*"(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?=(?:[^{}]*?[,\n])?[ \t]*(?:min_size|"min_size")\s*[=:]\s*2(?:\.0+)?(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?=(?:[^{}]*?[,\n])?[ \t]*(?:max_size|"max_size")\s*[=:]\s*4(?:\.0+)?(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?=(?:[^{}]*?[,\n])?[ \t]*(?:disk_gb|"disk_gb")\s*[=:]\s*100(?:\.0+)?(?=[ \t]*(?:[,}\r\n#]|\/\/)))(?:\s*(?:(?:(?:instance_type|"instance_type")|(?:min_size|"min_size")|(?:max_size|"max_size")|(?:disk_gb|"disk_gb"))\s*[=:]\s*(?:"[^"\n]*"|[^\s,}#\/]+)\s*,?|#[^\n]*|\/\/[^\n]*))*\s*\}'
target:
  source: file
  path: env/production/workers.auto.tfvars
weight: 0.5
---
