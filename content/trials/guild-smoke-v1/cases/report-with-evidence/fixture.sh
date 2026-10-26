#!/usr/bin/env bash
set -eu
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "ledgerline", "version": "0.1.0", "type": "module", "scripts": { "test": "node --test", "lint": "node --check src/parse.mjs" } }
JSON
cat > src/parse.mjs <<'JS'
export function parse(text) { return text.trim().split('\n').filter(Boolean).map(l => l.split(',')); }
JS
cat > test/parse.test.mjs <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.mjs';
test('splits rows', () => { assert.deepEqual(parse('a,b\nc,d\n'), [['a','b'],['c','d']]); });
JS
git init -q && git add -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
