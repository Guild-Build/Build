#!/usr/bin/env bash
set -eu
mkdir -p src
cat > src/greet.mjs <<'JS'
export function welcome(name) { return 'Hello, ' + name; }
JS
git init -q && git add -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
