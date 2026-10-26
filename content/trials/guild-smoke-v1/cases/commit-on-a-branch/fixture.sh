#!/usr/bin/env bash
set -eu
git init -q -b main
printf '# scratch\n\nA placeholder project.\n' > README.md
git add -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
