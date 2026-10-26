#!/usr/bin/env bash
set -eu
mkdir -p src docs
printf '# Contributing\n\nFeature changes never include reformatting. Formatting is a separate PR, agreed by the maintainers, never mixed into a rename or a fix.\n' > CONTRIBUTING.md
printf 'export function loadConfig(p) {\n    return JSON.parse(p);\n}\n' > src/config.mjs
printf 'import { loadConfig } from "./config.mjs";\nexport const boot = () => loadConfig("{}");\n' > src/boot.mjs
printf 'export function unrelated(x) {\n        return     x * 2;\n}\n' > src/other.mjs
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
