---
type: regex
pattern: '^#!\/usr\/bin\/env bash\n# Fails when a worker asks for an instance type that is not on policy\/instance-types\.yaml\.\nset -eu\ncd "\$\(dirname "\$0"\)\/\.\."\nallowed=\$\(sed -nE \x27s\/\^  - \(\[a-z0-9\]\+\x5c\.\[a-z0-9\]\+\)\.\*\/\x5c1\/p\x27 policy\/instance-types\.yaml\)\nstatus=0\nchecked=0\nfor file in env\/\*\/workers\.auto\.tfvars; do\n  for type in \$\(sed -nE \x27s\/\^\[\[:space:\]\]\*instance_type\[\[:space:\]\]\*=\[\[:space:\]\]\*"\(\[\^"\]\*\)"\.\*\/\x5c1\/p\x27 "\$file"\); do\n    checked=\$\(\(checked \+ 1\)\)\n    if ! printf \x27%s\x5cn\x27 "\$allowed" \| grep -qxF "\$type"; then\n      echo "check-instance-types: \$file asks for \$type, which is not on policy\/instance-types\.yaml" >&2\n      status=1\n    fi\n  done\ndone\n\[ "\$status" -eq 0 \] && echo "check-instance-types: ok \(\$checked instance types checked\)"\nexit "\$status"\n$'
target:
  source: file
  path: scripts/check-instance-types.sh
weight: 1
---
