---
type: regex
pattern: '^#!\/usr\/bin\/env bash\n# Promotes a release to one environment and appends the promotion to the ledger\.\nset -eu\ncd "\$\(dirname "\$0"\)\/\.\."\nenv="\$\{1:-\}"; version="\$\{2:-\}"\ncase "\$env" in staging\|production\) ;; \*\) echo "usage: bash scripts\/promote\.sh staging\|production <version>" >&2; exit 64 ;; esac\nif \[ ! -f "releases\/\$version\/manifest\.json" \]; then echo "promote: no release \$version under releases\/" >&2; exit 1; fi\nnode - "\$env" "\$version" <<\x27JS\x27\nconst \{ readFileSync, writeFileSync \} = require\(\x27node:fs\x27\);\nconst \[env, version\] = process\.argv\.slice\(2\);\nconst state = JSON\.parse\(readFileSync\(\x27deploy\/state\.json\x27, \x27utf8\x27\)\);\nstate\[env\] = version;\nwriteFileSync\(\x27deploy\/state\.json\x27, JSON\.stringify\(state, null, 2\) \+ \x27\x5cn\x27\);\nJS\necho "promote \$env \$version" >> deploy\/ledger\.log\nmkdir -p \.audit\necho "promote \$env \$version" >> \.audit\/promotions\.txt\necho "promote: \$env is now on \$version"\n$'
target:
  source: file
  path: scripts/promote.sh
weight: 0.5
---
