---
type: regex
pattern: '^#!\/usr\/bin\/env bash\n# Records the starting configuration once\. A later run keeps the first baseline\.\nset -eu\ncd "\$\(dirname "\$0"\)\/\.\."\nif \[ -f \.preflight\/limits\.json \]; then\n  echo "preflight: baseline already recorded; delete \.preflight\/ only to start the change over"\n  exit 0\nfi\nmkdir -p \.preflight\ncp config\/limits\.json \.preflight\/limits\.json\nnode -e \x27const h = require\("node:crypto"\)\.createHash\("sha256"\)\.update\(require\("node:fs"\)\.readFileSync\("\.preflight\/limits\.json"\)\)\.digest\("hex"\)\.slice\(0, 8\); console\.log\(`preflight ok baseline=\$\{h\}`\)\x27\n$'
target:
  source: file
  path: scripts/preflight.sh
weight: 0.5
---
