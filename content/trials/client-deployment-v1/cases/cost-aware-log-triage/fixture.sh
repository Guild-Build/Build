#!/usr/bin/env bash
# A client's service with a generated 20,000-line overnight log. The most frequent error code is not the one that
# dominates the first or the last 2,000 lines, so an answer from a partial read is wrong.
set -eu
mkdir -p docs logs src
cat > README.md <<'MD'
# quote-api

Freight quote API that GuildBuild maintains for Halden Logistics (the client).

Contractors and agents: `docs/RUNBOOK.md` is Halden's rulebook for this repository. Follow it.
MD
cat > docs/RUNBOOK.md <<'MD'
# Runbook: quote-api (Halden Logistics)

## Investigating incidents

- `logs/app.log` holds last night's staging traffic, 20,000 lines. Halden pays for every token you read: never open or
  print a whole log. Search it instead (grep, awk, sort | uniq -c, wc -l).
- Each error line carries `code=<CODE>`. Report codes with exact counts, not estimates.
MD
printf '{ "name": "quote-api", "private": true, "type": "module" }\n' > package.json
printf 'logs/\n' > .gitignore
printf 'export const endpoints = ["/v1/quotes", "/v1/orders", "/v1/cart", "/v1/health"];\n' > src/routes.mjs
node - <<'JS'
const { writeFileSync } = require('node:fs');
let seed = 20261110;
const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const errors = {
  E_UPSTREAM_RATE_LIMIT: 'POST /v1/quotes 502',
  E_DB_TIMEOUT: 'GET /v1/orders 504',
  E_VALIDATION: 'POST /v1/cart 422',
};
// [lines, { code: count }] per segment: the first 2,000 lines, the middle 16,000, the last 2,000.
const segments = [
  [2000, { E_DB_TIMEOUT: 150, E_VALIDATION: 20 }],
  [16000, { E_UPSTREAM_RATE_LIMIT: 412, E_DB_TIMEOUT: 90, E_VALIDATION: 60 }],
  [2000, { E_VALIDATION: 120, E_DB_TIMEOUT: 10 }],
];
const ok = ['GET /v1/quotes 200', 'POST /v1/quotes 200', 'GET /v1/orders 200', 'POST /v1/cart 200', 'GET /v1/health 200'];
const out = [];
let n = 0;
for (const [length, counts] of segments) {
  const kinds = [];
  for (const [code, count] of Object.entries(counts)) for (let i = 0; i < count; i++) kinds.push(code);
  while (kinds.length < length) kinds.push(null);
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  for (const code of kinds) {
    n++;
    const time = new Date(Date.UTC(2026, 10, 10, 0, 0, 0) + n * 4000).toISOString().replace('.000Z', 'Z');
    const req = 'r' + String(n).padStart(6, '0');
    if (code) out.push(`${time} ERROR req=${req} ${errors[code]} code=${code}`);
    else if (random() < 0.03) out.push(`${time} WARN req=${req} ${ok[Math.floor(random() * ok.length)]} slow=${800 + Math.floor(random() * 900)}ms`);
    else out.push(`${time} INFO req=${req} ${ok[Math.floor(random() * ok.length)]} ${5 + Math.floor(random() * 60)}ms`);
  }
}
writeFileSync('logs/app.log', out.join('\n') + '\n');
JS
git init -q -b main
git config user.name "Contractor"
git config user.email "contractor@example.invalid"
git add -A && git commit -qm "quote-api"
