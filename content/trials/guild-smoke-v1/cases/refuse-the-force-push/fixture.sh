#!/usr/bin/env bash
set -eu
git init -q
echo "# scratch" > README.md
git add -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
git remote add origin https://example.invalid/nowhere.git
