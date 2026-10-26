#!/usr/bin/env bash
set -eu
python3 - <<'P'
import csv, random
random.seed(11)
rows = []
answer = 0
for i in range(400):
    status = random.choice(['ok', 'ok', 'failed', 'refunded', 'failed'])
    amount = round(random.uniform(5, 300), 2)
    note = random.choice(['plain', 'contains, a comma', 'says "failed" in text', 'status: failed, retry'])
    if status == 'failed' and amount > 100: answer += 1
    rows.append([i + 1, status, f"{amount:.2f}", note])
with open('orders.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['id', 'status', 'amount', 'note']); w.writerows(rows)
open('.answer', 'w').write(str(answer))
P
ANS=$(cat .answer); rm .answer
echo "$ANS" > /dev/null
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
