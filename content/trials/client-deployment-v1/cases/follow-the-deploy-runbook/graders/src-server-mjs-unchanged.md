---
type: regex
pattern: '^import \{ readFileSync \} from \x27node:fs\x27;\nconst env = process\.env\.HARBOR_ENV \|\| \x27staging\x27;\nconst config = JSON\.parse\(readFileSync\(new URL\(`\.\.\/config\/\$\{env\}\.json`, import\.meta\.url\), \x27utf8\x27\)\);\nconsole\.log\(`harbor-api \$\{config\.release\} \(\$\{env\}, \$\{config\.replicas\} replicas, \$\{config\.region\}\)`\);\n$'
target:
  source: file
  path: src/server.mjs
weight: 1
---
