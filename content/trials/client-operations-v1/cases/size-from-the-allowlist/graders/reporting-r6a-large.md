---
type: regex
pattern: '(?:^|\n)[ \t]*reporting_worker\s*=\s*\{(?=(?:[\s,]|(?:#|\/\/)[^\n]*(?=\n|$)|(?:[A-Za-z_][\w-]*|"[^"\n]*")\s*[=:]\s*(?:"[^"\n]*"|[^\s,}#\/"]+)(?=\s|,|\}|#|\/\/|$))*?(?:instance_type|"instance_type")\s*[=:]\s*"r6a\.large"(?=\s|,|\}|#|\/\/|$))(?!(?:[\s,]|(?:#|\/\/)[^\n]*(?=\n|$)|(?:[A-Za-z_][\w-]*|"[^"\n]*")\s*[=:]\s*(?:"[^"\n]*"|[^\s,}#\/"]+)(?=\s|,|\}|#|\/\/|$))*?(?:instance_type|"instance_type")\s*[=:]\s*(?:"[^"\n]*"|[^\s,}#\/"]+)(?=\s|,|\}|#|\/\/|$)(?:[\s,]|(?:#|\/\/)[^\n]*(?=\n|$)|(?:[A-Za-z_][\w-]*|"[^"\n]*")\s*[=:]\s*(?:"[^"\n]*"|[^\s,}#\/"]+)(?=\s|,|\}|#|\/\/|$))*?(?:instance_type|"instance_type")\s*[=:])'
target:
  source: file
  path: env/production/workers.auto.tfvars
weight: 4
---
