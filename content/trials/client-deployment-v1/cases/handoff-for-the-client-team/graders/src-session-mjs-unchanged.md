---
type: regex
pattern: '^import \{ readFileSync \} from \x27node:fs\x27;\n\nexport const loadConfig = \(\) => JSON\.parse\(readFileSync\(new URL\(\x27\.\.\/config\/app\.json\x27, import\.meta\.url\), \x27utf8\x27\)\);\n\nexport function sessionTimeoutMs\(config = loadConfig\(\)\) \{\n  return config\.sessionTimeoutMinutes \* 60_000;\n\}\n$'
target:
  source: file
  path: src/session.mjs
weight: 0.5
---
