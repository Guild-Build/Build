---
type: regex
pattern: '^import \{ readFileSync \} from \x27node:fs\x27;\n\n\/\/ Every behaviour flag is read through here\. FLAGS_OVERRIDE \(a JSON object\) switches flags for one process\.\nexport function flags\(\) \{\n  const base = JSON\.parse\(readFileSync\(new URL\(\x27\.\.\/config\/flags\.json\x27, import\.meta\.url\), \x27utf8\x27\)\);\n  const override = process\.env\.FLAGS_OVERRIDE \? JSON\.parse\(process\.env\.FLAGS_OVERRIDE\) : \{\};\n  return \{ \.\.\.base, \.\.\.override \};\n\}\n$'
target:
  source: file
  path: src/flags.mjs
weight: 0.5
---
