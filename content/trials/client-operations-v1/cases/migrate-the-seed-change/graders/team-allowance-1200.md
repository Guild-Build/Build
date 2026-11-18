---
type: regex
pattern: '(?:^|\n)[ \t]*\[[ \t]*(?:team|"team"|\x27team\x27)[ \t]*\][ \t]*(?:#[^\n]*)?\r?(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:invoice_allowance|"invoice_allowance"|\x27invoice_allowance\x27)[ \t]*=[ \t]*\+?1200[ \t]*(?:#[^\n]*)?\r?(?=\n|$)'
target:
  source: file
  path: seed/plans.toml
weight: 1
---
