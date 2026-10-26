#!/usr/bin/env bash
set -eu
mkdir -p src test
printf '{ "name": "clock", "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
cat > src/greeting.mjs <<'J'
export function greeting(now = new Date()) {
  const h = now.getUTCHours();
  return h < 12 ? 'good morning' : 'good afternoon';
}
export function pick(items, rnd = Math.random) {
  return items[Math.floor(rnd() * items.length)];
}
J
cat > test/greeting.test.mjs <<'J'
import test from 'node:test';
import assert from 'node:assert/strict';
import { greeting, pick } from '../src/greeting.mjs';
test('morning greeting', () => { assert.equal(greeting(), 'good morning'); });
test('pick returns the first item', () => { assert.equal(pick(['a', 'b', 'c']), 'a'); });
J
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
