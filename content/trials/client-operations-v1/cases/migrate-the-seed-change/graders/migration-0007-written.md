---
type: regex
pattern: '^-- Written by scripts\/seed_migration\.py: seed\/ changed since the last commit\.\nUPDATE plans SET settings = jsonb_set\(settings, \x27\{invoice_allowance\}\x27, \x271200\x27\) WHERE code = \x27team\x27;\n$'
target:
  source: file
  path: migrations/0007_seed_plans.sql
weight: 2
---
