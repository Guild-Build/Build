#!/usr/bin/env bash
# A client's Python library whose changelog is built at release time from one news fragment per pull request.
set -eu
mkdir -p src/slugkit tests newsfragments .github/workflows
cat > README.md <<'MD'
# slugkit

URL slugs from any text, for Python 3.10 and later. Maintained by Wren Labs.

```python
>>> from slugkit import slugify
>>> slugify("Crème brûlée, 2 ways")
'creme-brulee-2-ways'
```

See CHANGES.md for what changed in each release, and CONTRIBUTING.md before you open a pull request.
MD
cat > CONTRIBUTING.md <<'MD'
# Contributing to slugkit

## Setting up

    uv sync
    uv run python -m unittest discover -s tests

## Pull requests

- One change per pull request, with a test that fails without it.
- Keep the public API in `slugkit/__init__.py` stable; a removal needs a deprecation release first.

## Changelog

Do not edit CHANGES.md: towncrier builds it from news fragments when a release is cut. Every pull request adds one
fragment, `newsfragments/<issue>.<type>.md`, where `<issue>` is the GitHub issue number and `<type>` is one of:

- `feature`: a new function or option;
- `bugfix`: something that gave a wrong result now gives the right one;
- `removal`: something deprecated or removed.

Write one or two sentences for users, not for reviewers.
MD
cat > pyproject.toml <<'TOML'
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "slugkit"
version = "2.4.0"
description = "URL slugs from any text"
requires-python = ">=3.10"
license = { text = "MIT" }

[tool.setuptools.packages.find]
where = ["src"]

[tool.towncrier]
directory = "newsfragments"
filename = "CHANGES.md"
start_string = "<!-- towncrier release notes start -->\n"
title_format = "## {version} ({project_date})"
issue_format = "#{issue}"

[[tool.towncrier.type]]
directory = "feature"
name = "Features"
showcontent = true

[[tool.towncrier.type]]
directory = "bugfix"
name = "Bug fixes"
showcontent = true

[[tool.towncrier.type]]
directory = "removal"
name = "Deprecations and removals"
showcontent = true
TOML
cat > CHANGES.md <<'MD'
# Changes

<!-- towncrier release notes start -->

## 2.4.0 (2026-09-14)

### Features

- `slugify` takes a `max_length` option and cuts the slug at the last separator before it. (#301)

### Bug fixes

- Apostrophes no longer split a word: "Don't" becomes "dont", not "don-t". (#296)

## 2.3.1 (2026-07-02)

### Bug fixes

- "Æ" and "æ" now come out as "ae" instead of being dropped. (#288)
MD
printf '!.gitignore\n' > newsfragments/.gitignore
printf '__pycache__/\n*.egg-info/\n.venv/\n' > .gitignore
cat > src/slugkit/__init__.py <<'PY'
"""URL slugs from any text."""

from .core import slugify

__all__ = ["slugify"]
PY
cat > src/slugkit/charmap.py <<'PY'
"""Letters that Unicode decomposition does not reduce to ASCII the way readers expect, and what slugify writes."""

CHARMAP = {
    "ä": "ae",
    "ö": "oe",
    "ü": "ue",
    "æ": "ae",
    "ø": "oe",
    "đ": "d",
}
PY
cat > src/slugkit/core.py <<'PY'
import re
import unicodedata

from .charmap import CHARMAP

_APOSTROPHES = re.compile(r"['’]")
_SEPARATORS = re.compile(r"[^a-z0-9]+")


def slugify(text: str, separator: str = "-", max_length: int | None = None) -> str:
    """Return a lowercase ASCII slug of text, its words joined by separator."""
    text = _APOSTROPHES.sub("", text.lower())
    text = "".join(CHARMAP.get(ch, ch) for ch in text)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = _SEPARATORS.sub(separator, text).strip(separator)
    if max_length is not None and len(slug) > max_length:
        cut = slug.rfind(separator, 0, max_length + 1)
        slug = slug[: cut if cut > 0 else max_length]
    return slug
PY
cat > tests/test_slugify.py <<'PY'
import unittest

from slugkit import slugify


class SlugifyTest(unittest.TestCase):
    def test_accents_are_dropped(self):
        self.assertEqual(slugify("Crème brûlée, 2 ways"), "creme-brulee-2-ways")

    def test_letters_from_the_map(self):
        self.assertEqual(slugify("Ærøskøbing"), "aeroeskoebing")
        self.assertEqual(slugify("Müller"), "mueller")

    def test_apostrophes_join_words(self):
        self.assertEqual(slugify("Don't panic"), "dont-panic")

    def test_max_length_cuts_at_a_separator(self):
        self.assertEqual(slugify("a long title here", max_length=8), "a-long")


if __name__ == "__main__":
    unittest.main()
PY
cat > .github/workflows/ci.yml <<'YAML'
name: ci
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        python: ["3.10", "3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: astral-sh/setup-uv@v5
        with:
          python-version: ${{ matrix.python }}
      - run: uv sync
      - run: uv run python -m unittest discover -s tests
      - run: uvx towncrier check --compare-with origin/main
YAML
git init -q -b main
git config user.name "Contractor"
git config user.email "contractor@example.invalid"
# Inside Claude Code's sandbox the folder also holds an entry that cannot be opened over each name the sandbox
# protects (Claude Code 2.1.322). Git leaves them out, so git status stays clean and git add -A works there too.
mkdir -p .git/info
printf '%s\n' /.bash_profile /.bashrc /.claude/ /.eval-artifacts /.gitconfig /.gitmodules /.idea /.mcp.json /.profile /.ripgreprc /.vscode /.zprofile /.zshrc >> .git/info/exclude
git add -A && git commit -qm "slugkit 2.4.0"
