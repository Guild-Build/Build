#!/usr/bin/env bash
set -eu
printf '# notify\n\nSends an email when we recieve a webhook.\n' > README.md
printf '{ "name": "notify", "version": "1.4.0" }\n' > package.json
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
