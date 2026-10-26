#!/usr/bin/env bash
set -eu
mkdir -p src docs
cat > src/greet.mjs <<'JS'
export function greet(name) { return 'Hello, ' + name; }
JS
cat > src/main.mjs <<'JS'
import { greet } from './greet.mjs';
console.log(greet('guild'));
JS
cat > docs/NOTES.md <<'MD'
The greet function says hello. Do not rename it in the docs; this file is frozen.
MD
git init -q && git add -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
