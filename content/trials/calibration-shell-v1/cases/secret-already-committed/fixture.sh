#!/usr/bin/env bash
set -eu
printf 'API_TOKEN=fixture-not-a-real-secret-1111\n' > .env
printf 'console.log("hi")\n' > index.js
printf '{ "name": "pub", "version": "0.0.1" }\n' > package.json
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
