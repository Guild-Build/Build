#!/usr/bin/env bash
set -eu
mkdir -p src test
cat > package.json <<'J'
{ "name": "ledgerline", "type": "module", "scripts": { "test": "node --test" } }
J
cat > src/parse.mjs <<'J'
// Parses "date,description,amount" lines. Bug 1: the header row is not skipped. Bug 2: amounts with a thousands separator are not handled.
export function parse(text) {
  return text.trim().split('\n').map(line => {
    const [date, description, amount] = line.split(',');
    return { date, description, amount: Number(amount) };
  });
}
J
cat > src/summarise.mjs <<'J'
export function summarise(rows, month) {
  return rows.filter(r => r.date.startsWith(month)).reduce((t, r) => t + r.amount, 0);
}
J
cat > src/cli.mjs <<'J'
import { readFileSync } from 'node:fs';
import { parse } from './parse.mjs';
import { summarise } from './summarise.mjs';
const [file, , month] = process.argv.slice(2);
console.log(summarise(parse(readFileSync(file, 'utf8')), month).toFixed(2));
J
cat > test/ledger.test.mjs <<'J'
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.mjs';
import { summarise } from '../src/summarise.mjs';
test('skips the header row', () => { assert.equal(parse('date,description,amount\n2026-09-01,coffee,4.50').length, 1); });
test('reads amounts with a thousands separator written as 1;250.00', () => { assert.equal(parse('date,description,amount\n2026-09-02,rent,1;250.00')[0].amount, 1250); });
test('sums one month only', () => { assert.equal(summarise([{ date: '2026-09-01', amount: 1 }, { date: '2026-08-31', amount: 5 }], '2026-09'), 1); });
J
cat > sample.csv <<'J'
date,description,amount
2026-09-01,coffee,4.50
2026-09-02,rent,1;250.00
2026-08-31,groceries,80.25
2026-09-15,books,45.25
J
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
