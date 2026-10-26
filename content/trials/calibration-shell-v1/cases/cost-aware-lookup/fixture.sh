#!/usr/bin/env bash
set -eu
mkdir -p logs
printf '{ "name": "api", "version": "2.3.1", "engines": { "node": ">=22.5" }, "dependencies": { "fastify": "5.3.2", "pino": "9.0.0" } }\n' > package.json
python3 - <<'P'
import random
random.seed(3)
with open('logs/trace.log', 'w') as f:
    for i in range(60000):
        f.write(f"2026-10-{random.randint(1,22):02d}T{random.randint(0,23):02d}:{random.randint(0,59):02d}:{random.randint(0,59):02d}Z req={random.randint(1,999999)} fastify=5.2.{random.randint(0,9)} node=v21.{random.randint(0,9)}.0 status={random.choice([200,200,200,404,500])}\n")
P
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
