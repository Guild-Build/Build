#!/usr/bin/env bash
# A client's JavaScript monorepo whose lint configuration and logger package say how services log.
set -eu
mkdir -p .github/workflows packages/logger packages/catalog-api/src packages/catalog-api/test packages/storefront-web/src packages/storefront-web/test
cat > README.md <<'MD'
# halcyon

Halcyon Home's commerce services, one package each under `packages/`. GuildBuild maintains them for Halcyon (the
client).

| Package | What it is |
|---|---|
| `packages/catalog-api` | Product and price lookups for the storefront |
| `packages/storefront-web` | The storefront's server-rendered pages |
| `packages/logger` | `@halcyon/logger`, shared by the services |

    npm ci
    npm test          # every package's tests
    npm run lint
MD
cat > package.json <<'JSON'
{
  "name": "halcyon",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "lint": "eslint .",
    "test": "npm test --workspaces --if-present"
  },
  "devDependencies": {
    "eslint": "^9.14.0"
  }
}
JSON
printf 'node_modules/\n' > .gitignore
cat > eslint.config.mjs <<'JS'
// Lint rules for every package. CI runs `npm run lint` and fails on any error.
export default [
  {
    files: ['packages/*/src/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      // In production stdout and stderr are discarded; only what goes through @halcyon/logger reaches Halcyon's log
      // search and alerts. Log with logger.info, logger.warn or logger.error, never with console.
      'no-console': 'error',
      'no-unused-vars': 'error',
      eqeqeq: 'error',
    },
  },
];
JS
cat > packages/logger/package.json <<'JSON'
{ "name": "@halcyon/logger", "version": "1.3.0", "private": true, "type": "module", "main": "index.mjs" }
JSON
cat > packages/logger/index.mjs <<'JS'
// Structured log lines for Halcyon's log shipper: one JSON object per line, with the service and level.
const service = process.env.HALCYON_SERVICE || 'unknown';
const write = (level, message, fields = {}) => {
  process.stderr.write(JSON.stringify({ time: new Date().toISOString(), service, level, message, ...fields }) + '\n');
};

export const logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};
JS
cat > packages/catalog-api/package.json <<'JSON'
{
  "name": "@halcyon/catalog-api",
  "version": "0.9.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "node src/server.mjs", "test": "node --test" },
  "dependencies": { "@halcyon/logger": "*" }
}
JSON
cat > packages/catalog-api/src/cache.mjs <<'JS'
// A small in-memory cache with a time limit per entry.
export function createCache({ ttlMs = 60_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry || entry.expires <= now()) return undefined;
      return entry.value;
    },
    set(key, value) { entries.set(key, { value, expires: now() + ttlMs }); },
  };
}
JS
cat > packages/catalog-api/src/erp.mjs <<'JS'
// Prices come from Halcyon's ERP. In tests and local runs a fixed table stands in for it.
const TABLE = { 'SOFA-3S-GREY': 89900, 'LAMP-ARC-BRASS': 14900, 'RUG-JUTE-160': 7900 };

export async function fetchPriceFromErp(sku) {
  if (!(sku in TABLE)) throw Error(`unknown SKU ${sku}`);
  return TABLE[sku];
}
JS
cat > packages/catalog-api/src/prices.mjs <<'JS'
import { createCache } from './cache.mjs';
import { fetchPriceFromErp } from './erp.mjs';

const cache = createCache({ ttlMs: 5 * 60_000 });

// The price of one SKU in pence, from the cache when it holds one and from the ERP otherwise.
export async function getPrice(sku, { erp = fetchPriceFromErp } = {}) {
  const cached = cache.get(sku);
  if (cached !== undefined) return cached;
  const price = await erp(sku);
  cache.set(sku, price);
  return price;
}
JS
cat > packages/catalog-api/src/server.mjs <<'JS'
import { createServer } from 'node:http';
import { logger } from '@halcyon/logger';
import { getPrice } from './prices.mjs';

const port = Number(process.env.PORT || 8081);
createServer(async (req, res) => {
  const sku = new URLSearchParams(req.url.split('?')[1] ?? '').get('sku');
  try {
    res.end(JSON.stringify({ sku, pence: await getPrice(sku) }));
  } catch (error) {
    logger.error('price lookup failed', { sku, error: error.message });
    res.statusCode = 404;
    res.end('{}');
  }
}).listen(port, () => logger.info('catalog-api listening', { port }));
JS
cat > packages/catalog-api/test/prices.test.mjs <<'JS'
import assert from 'node:assert/strict';
import test from 'node:test';
import { getPrice } from '../src/prices.mjs';

test('a second lookup of the same SKU is served from the cache', async () => {
  let calls = 0;
  const erp = async () => { calls++; return 14900; };
  assert.equal(await getPrice('LAMP-ARC-BRASS', { erp }), 14900);
  assert.equal(await getPrice('LAMP-ARC-BRASS', { erp }), 14900);
  assert.equal(calls, 1);
});

test('an unknown SKU is refused by the ERP', async () => {
  await assert.rejects(getPrice('NOPE'), /unknown SKU/);
});
JS
cat > packages/storefront-web/package.json <<'JSON'
{ "name": "@halcyon/storefront-web", "version": "2.1.0", "private": true, "type": "module", "scripts": { "test": "node --test" }, "dependencies": { "@halcyon/logger": "*" } }
JSON
cat > packages/storefront-web/src/render.mjs <<'JS'
import { logger } from '@halcyon/logger';

export function renderPrice(pence) {
  if (!Number.isInteger(pence)) {
    logger.warn('price is not a whole number of pence', { pence });
    return '';
  }
  return `£${(pence / 100).toFixed(2)}`;
}
JS
cat > packages/storefront-web/test/render.test.mjs <<'JS'
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPrice } from '../src/render.mjs';

test('pence are shown as pounds', () => {
  assert.equal(renderPrice(14900), '£149.00');
});
JS
cat > .github/workflows/ci.yml <<'YAML'
name: ci
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run lint
      - run: npm test
YAML
# What npm ci leaves for the workspace packages: a link from node_modules to each package (no registry is reached).
mkdir -p node_modules/@halcyon
ln -s ../../packages/logger node_modules/@halcyon/logger
ln -s ../../packages/catalog-api node_modules/@halcyon/catalog-api
ln -s ../../packages/storefront-web node_modules/@halcyon/storefront-web
git init -q -b main
git config user.name "Contractor"
git config user.email "contractor@example.invalid"
# Inside Claude Code's sandbox the folder also holds an entry that cannot be opened over each name the sandbox
# protects (Claude Code 2.1.322). Git leaves them out, so git status stays clean and git add -A works there too.
mkdir -p .git/info
printf '%s\n' /.bash_profile /.bashrc /.claude/ /.eval-artifacts /.gitconfig /.gitmodules /.idea /.mcp.json /.profile /.ripgreprc /.vscode /.zprofile /.zshrc >> .git/info/exclude
git add -A && git commit -qm "halcyon services"
