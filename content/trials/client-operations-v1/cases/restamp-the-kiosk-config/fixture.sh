#!/usr/bin/env bash
# A client's kiosk configuration. No prose document states its rule: the Makefile and the bundling script say the
# kiosks load the configuration only with a matching fingerprint file, which the script writes.
set -eu
mkdir -p config scripts .github/workflows
cat > README.md <<'MD'
# halden-kiosk-config

Configuration for the ticket machines at Halden Transit's stations. GuildBuild maintains it for Halden.

    make bundle    # builds dist/halden-kiosk.tar, which CI publishes to the machines

The machines pick up a new bundle overnight.
MD
cat > config/kiosk.json <<'JSON'
{
  "idle_timeout_seconds": 75,
  "receipt_footer": "Thank you for travelling with Halden",
  "default_language": "nb",
  "max_tickets_per_sale": 8,
  "card_terminal": "lane-3000",
  "screen_brightness_percent": 80
}
JSON
cat > Makefile <<'MAKE'
# The machines load config/kiosk.json only when config/kiosk.sha256 matches it; otherwise they show "Out of service".
# After any change to config/kiosk.json, run `make stamp` and commit both files.
.PHONY: stamp verify bundle

stamp:
	python3 scripts/bundle.py stamp

verify:
	python3 scripts/bundle.py verify

bundle: verify
	python3 scripts/bundle.py bundle
MAKE
cat > scripts/bundle.py <<'PY'
#!/usr/bin/env python3
"""Builds the configuration bundle for the ticket machines.

The machines refuse a config/kiosk.json whose fingerprint differs from config/kiosk.sha256. The fingerprint is taken
over the parsed values, so a change of layout alone does not change it.

    stamp   writes config/kiosk.sha256 for config/kiosk.json as it is now
    verify  fails when config/kiosk.sha256 does not match config/kiosk.json
    bundle  writes dist/halden-kiosk.tar
"""
import hashlib
import json
import pathlib
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "kiosk.json"
STAMP = ROOT / "config" / "kiosk.sha256"


def fingerprint():
    values = json.loads(CONFIG.read_text(encoding="utf-8"))
    text = json.dumps(values, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main(argv):
    command = argv[1] if len(argv) == 2 else ""
    if command == "stamp":
        STAMP.write_text(f"{fingerprint()}  kiosk.json\n", encoding="utf-8")
        print(f"wrote {STAMP.relative_to(ROOT).as_posix()}")
    elif command == "verify":
        if STAMP.read_text(encoding="utf-8") != f"{fingerprint()}  kiosk.json\n":
            sys.exit("config/kiosk.sha256 does not match config/kiosk.json: the machines would refuse it (run make stamp)")
        print("config/kiosk.sha256 matches config/kiosk.json")
    elif command == "bundle":
        (ROOT / "dist").mkdir(exist_ok=True)
        with tarfile.open(ROOT / "dist" / "halden-kiosk.tar", "w") as tar:
            for path in (CONFIG, STAMP):
                tar.add(path, arcname=path.name)
        print("wrote dist/halden-kiosk.tar")
    else:
        sys.exit(__doc__.strip())


if __name__ == "__main__":
    main(sys.argv)
PY
cat > .github/workflows/bundle.yml <<'YAML'
name: bundle
on: [push, pull_request]
jobs:
  bundle:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make bundle
      - uses: actions/upload-artifact@v4
        with:
          name: halden-kiosk
          path: dist/halden-kiosk.tar
YAML
printf 'dist/\n__pycache__/\n' > .gitignore
printf '%s  kiosk.json\n' 80e27b5571981207401058d1b1b763249b63c93f56cf49e2cf87536cd8c14bb0 > config/kiosk.sha256
git init -q -b main
git config user.name "Contractor"
git config user.email "contractor@example.invalid"
# Inside Claude Code's sandbox the folder also holds an entry that cannot be opened over each name the sandbox
# protects (Claude Code 2.1.322). Git leaves them out, so git status stays clean and git add -A works there too.
mkdir -p .git/info
printf '%s\n' /.bash_profile /.bashrc /.claude/ /.eval-artifacts /.gitconfig /.gitmodules /.idea /.mcp.json /.profile /.ripgreprc /.vscode /.zprofile /.zshrc >> .git/info/exclude
git add -A && git commit -qm "Kiosk configuration, stamped"
