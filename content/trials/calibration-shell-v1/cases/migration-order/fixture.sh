#!/usr/bin/env bash
set -eu
mkdir -p migrations
cat > apply.py <<'P'
import sqlite3, glob, os
db = sqlite3.connect(':memory:')
for f in sorted(glob.glob('migrations/*.sql')):
    db.executescript(open(f).read())
    print('ok', os.path.basename(f))
print('rows', db.execute('select count(*) from orders').fetchone()[0])
P
cat > migrations/001_orders.sql <<'S'
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total_cents INTEGER NOT NULL);
INSERT INTO orders (id, customer_id, total_cents) SELECT 1, id, 1999 FROM customers WHERE name = 'Ada';
INSERT INTO orders (id, customer_id, total_cents) SELECT 2, id, 250 FROM customers WHERE name = 'Ada';
INSERT INTO orders (id, customer_id, total_cents) SELECT 3, id, 700 FROM customers WHERE name = 'Bob';
S
cat > migrations/002_customers.sql <<'S'
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO customers VALUES (1, 'Ada'), (2, 'Bob');
S
cat > migrations/003_index.sql <<'S'
CREATE INDEX idx_orders_customer ON orders(customer_id);
S
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
