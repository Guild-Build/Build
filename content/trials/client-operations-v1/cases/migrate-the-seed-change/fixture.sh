#!/usr/bin/env bash
# A client's database repository: numbered migrations, and reference data that only a new database is filled from.
# Its seed folder's own README asks for a migration, written by the client's script, with every change to the folder.
set -eu
mkdir -p migrations scripts seed
cat > README.md <<'MD'
# ledgerline-db

The Postgres schema and reference data of Ledgerline, the bookkeeping service. GuildBuild maintains it for Ledgerline.

- `migrations/` holds the schema changes, numbered. Each deploy runs the ones the database has not run yet, in order,
  and records them in `schema_migrations`.
- `seed/` holds the reference data a new database starts with (see `seed/README.md`).

`python3 scripts/migrations.py` lists the migrations in the order a deploy runs them.
MD
cat > seed/README.md <<'MD'
# seed/

Reference data a new Ledgerline database starts with. Each file is one table, and each `[section]` of a file is one
row, keyed by its code; its values are stored in the row's `settings` column.

## Changing a file here

A database is filled from these files once, when it is created, and never reads them again. So every change to a
file in this folder needs a migration that makes the same change in the databases that already exist. After you edit
a file here, and before you commit, run:

    python3 scripts/seed_migration.py

It compares `seed/` with the last commit and writes the next numbered migration in `migrations/`. Commit that file
with your change; the next deploy runs it. Do not write these migrations by hand: the deploy expects the form the
script writes.
MD
cat > seed/plans.toml <<'TOML'
# Plans, keyed by code. Prices are in pence a month.

[starter]
price_pence = 900
seats = 1
invoice_allowance = 40

[team]
price_pence = 2900
seats = 10
invoice_allowance = 750

[business]
price_pence = 7900
seats = 50
invoice_allowance = 5000
TOML
cat > seed/currencies.toml <<'TOML'
# Currencies a ledger can be kept in, keyed by ISO 4217 code.

[GBP]
symbol = "£"
minor_units = 2

[EUR]
symbol = "€"
minor_units = 2

[JPY]
symbol = "¥"
minor_units = 0
TOML
cat > migrations/0001_init.sql <<'SQL'
CREATE TABLE plans (
  code TEXT PRIMARY KEY,
  settings JSONB NOT NULL
);

CREATE TABLE currencies (
  code TEXT PRIMARY KEY,
  settings JSONB NOT NULL
);

CREATE TABLE ledgers (
  id BIGSERIAL PRIMARY KEY,
  plan_code TEXT NOT NULL REFERENCES plans (code),
  currency_code TEXT NOT NULL REFERENCES currencies (code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL
cat > migrations/0002_ledgers_name.sql <<'SQL'
ALTER TABLE ledgers ADD COLUMN name TEXT NOT NULL DEFAULT '';
SQL
cat > migrations/0003_seed_plans.sql <<'SQL'
-- Written by scripts/seed_migration.py: seed/ changed since the last commit.
UPDATE plans SET settings = jsonb_set(settings, '{seats}', '50') WHERE code = 'business';
SQL
cat > migrations/0004_entries.sql <<'SQL'
CREATE TABLE entries (
  id BIGSERIAL PRIMARY KEY,
  ledger_id BIGINT NOT NULL REFERENCES ledgers (id),
  posted_on DATE NOT NULL,
  amount_minor BIGINT NOT NULL,
  memo TEXT NOT NULL DEFAULT ''
);
SQL
cat > migrations/0005_seed_currencies.sql <<'SQL'
-- Written by scripts/seed_migration.py: seed/ changed since the last commit.
INSERT INTO currencies (code, settings) VALUES ('JPY', '{"minor_units": 0, "symbol": "¥"}');
SQL
cat > migrations/0006_entries_ledger_index.sql <<'SQL'
CREATE INDEX entries_ledger_posted ON entries (ledger_id, posted_on);
SQL
cat > scripts/migrations.py <<'PY'
#!/usr/bin/env python3
"""Lists the migrations in migrations/ in the order a deploy runs them."""
import pathlib

for path in sorted((pathlib.Path(__file__).resolve().parent.parent / "migrations").glob("*.sql")):
    print(path.name)
PY
cat > scripts/seed_migration.py <<'PY'
#!/usr/bin/env python3
"""Writes the migration that makes the databases that already exist match seed/.

Compares each file in seed/ with the last commit and writes the statements for every row and value that changed to
migrations/<next number>_seed_<files>.sql, numbered after the last committed migration. Running it again rewrites
the same file.
"""
import json
import pathlib
import subprocess
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def committed(rel):
    shown = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=ROOT, capture_output=True)
    return tomllib.loads(shown.stdout.decode("utf-8")) if shown.returncode == 0 else {}


def literal(value):
    return "'" + json.dumps(value, sort_keys=True, ensure_ascii=False).replace("'", "''") + "'"


def statements(table, old, new):
    out = []
    for code in sorted(set(old) | set(new)):
        if code not in new:
            out.append(f"DELETE FROM {table} WHERE code = '{code}';")
        elif code not in old:
            out.append(f"INSERT INTO {table} (code, settings) VALUES ('{code}', {literal(new[code])});")
        else:
            for key in sorted(set(old[code]) | set(new[code])):
                if key not in new[code]:
                    out.append(f"UPDATE {table} SET settings = settings - '{key}' WHERE code = '{code}';")
                elif old[code].get(key) != new[code][key]:
                    out.append(f"UPDATE {table} SET settings = jsonb_set(settings, '{{{key}}}', {literal(new[code][key])}) WHERE code = '{code}';")
    return out


def main():
    changed, lines = [], []
    for path in sorted((ROOT / "seed").glob("*.toml")):
        rel = path.relative_to(ROOT).as_posix()
        with path.open("rb") as f:
            out = statements(path.stem, committed(rel), tomllib.load(f))
        if out:
            changed.append(path.stem)
            lines += out
    if not lines:
        print("seed/ matches the last commit: nothing to migrate")
        return
    listed = subprocess.run(["git", "ls-files", "migrations"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    number = max(int(pathlib.Path(name).name[:4]) for name in listed) + 1
    target = ROOT / "migrations" / f"{number:04d}_seed_{'_'.join(changed)}.sql"
    target.write_text("-- Written by scripts/seed_migration.py: seed/ changed since the last commit.\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {target.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    sys.exit(main())
PY
printf '__pycache__/\n' > .gitignore
git init -q -b main
git config user.name "Contractor"
git config user.email "contractor@example.invalid"
# Inside Claude Code's sandbox the folder also holds an entry that cannot be opened over each name the sandbox
# protects (Claude Code 2.1.322). Git leaves them out, so git status stays clean and git add -A works there too.
mkdir -p .git/info
printf '%s\n' /.bash_profile /.bashrc /.claude/ /.eval-artifacts /.gitconfig /.gitmodules /.idea /.mcp.json /.profile /.ripgreprc /.vscode /.zprofile /.zshrc >> .git/info/exclude
git add -A && git commit -qm "ledgerline-db after migration 0006"
