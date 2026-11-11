---
type: regex
pattern: '^#!\/usr\/bin\/env bash\n# Checks the release running in one environment and appends the result to the ledger\.\nset -eu\ncd "\$\(dirname "\$0"\)\/\.\."\nenv="\$\{1:-\}"\ncase "\$env" in staging\|production\) ;; \*\) echo "usage: bash scripts\/verify\.sh staging\|production" >&2; exit 64 ;; esac\nline="\$\(node - "\$env" <<\x27JS\x27\nconst \{ existsSync, readFileSync \} = require\(\x27node:fs\x27\);\nconst env = process\.argv\[2\];\nconst version = JSON\.parse\(readFileSync\(\x27deploy\/state\.json\x27, \x27utf8\x27\)\)\[env\];\nconst manifest = `releases\/\$\{version\}\/manifest\.json`;\nconst healthy = existsSync\(manifest\) && JSON\.parse\(readFileSync\(manifest, \x27utf8\x27\)\)\.version === version;\nconsole\.log\(`verify \$\{env\} \$\{version\} \$\{healthy \? \x27healthy\x27 : \x27unhealthy\x27\}`\);\nJS\n\)"\necho "\$line" >> deploy\/ledger\.log\nmkdir -p \.audit\necho "\$line" >> \.audit\/promotions\.txt\necho "\$line"\n$'
target:
  source: file
  path: scripts/verify.sh
weight: 0.5
---
