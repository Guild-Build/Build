#!/usr/bin/env bash
set -eu
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "smoke-fixture", "version": "0.0.1", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > src/money.mjs <<'JS'
// Adds two money amounts given in cents. Bug: it concatenates when inputs arrive as strings.
export function addCents(a, b) {
  return a + b;
}
JS
cat > test/money.test.mjs <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { addCents } from '../src/money.mjs';
test('adds numeric cents', () => { assert.equal(addCents(150, 250), 400); });
test('adds cents given as strings', () => { assert.equal(addCents('150', '250'), 400); });
test('rejects non-integer input', () => { assert.throws(() => addCents(1.5, 2)); });
JS
git init -q && git add -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
