#!/usr/bin/env bash
set -eu
mkdir -p src docs
cat > README.md <<'MD'
# ledgerline
A command-line tool that reads bank CSV exports and prints a monthly spend summary. See docs/usage.md.
MD
cat > docs/usage.md <<'MD'
Run: node src/cli.mjs statement.csv --month 2026-09
MD
cat > src/cli.mjs <<'JS'
import { parse } from './parse.mjs';
import { summarise } from './summarise.mjs';
const [file, , month] = process.argv.slice(2);
console.log(summarise(parse(file), month));
JS
cat > src/parse.mjs <<'JS'
export function parse(path) { return []; }
JS
cat > src/summarise.mjs <<'JS'
export function summarise(rows, month) { return { month, total: 0 }; }
JS
git init -q && git add -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
