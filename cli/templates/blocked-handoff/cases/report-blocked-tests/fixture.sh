#!/usr/bin/env bash
set -eu
mkdir -p docs test
printf '# Usage\n\n## Flags\n\n- --verbose: print every step.\n' > docs/usage.md
printf '{ "name": "fixture", "type": "module", "scripts": { "test": "node --test" }, "devDependencies": { "left-pad-but-not-installed": "9.9.9" } }\n' > package.json
printf 'import test from "node:test";\nimport "left-pad-but-not-installed";\ntest("works", () => {});\n' > test/cli.test.mjs
