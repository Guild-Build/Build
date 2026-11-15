#!/usr/bin/env bash
# A client's web service with contributor, release and design documents, none of which governs a copy fix in an email.
set -eu
mkdir -p docs/adr src/api src/email templates/email test db/migrations
cat > README.md <<'MD'
# juniper-api

The API behind Juniper Books' storefront and apps: catalogue, accounts and orders. GuildBuild maintains it for Juniper
(the client).

    npm ci
    npm test        # unit tests
    npm start       # local server on port 8080

Read CONTRIBUTING.md before you open a pull request.
MD
cat > CONTRIBUTING.md <<'MD'
# Contributing to juniper-api

## API changes

A change to a route in `src/api/` or to `openapi.yaml` is an API change. Juniper's app teams build against the
published contract, so an API change needs both of these in the same pull request:

1. a line under "Unreleased" in `docs/api-changelog.md`, saying what changed for a client of the API;
2. the next `info.version` in `openapi.yaml`: minor for an addition, major for a removal or a changed field.

## Database changes

Schema changes are new files in `db/migrations/`, numbered after the last one. Never edit a migration that has been
merged: production has already run it.

## Tests

`npm test` runs the unit tests. Run it before you push.
MD
cat > docs/RELEASING.md <<'MD'
# Releasing juniper-api

Juniper's release manager cuts a release every second Tuesday:

1. Move the "Unreleased" lines of `docs/api-changelog.md` under a heading for the new version.
2. Set `version` in `package.json` to the release number, commit "Release x.y.z" and tag it `vx.y.z`.
3. The deploy pipeline picks up the tag.

The version in `package.json` changes only in a release commit.
MD
cat > docs/adr/0004-transactional-email.md <<'MD'
# 4. Transactional email through Postmark

Date: 2026-03-18. Status: accepted.

## Context

Order and account emails were sent from the API servers over SMTP, and about 3% of them reached spam folders.

## Decision

Send every transactional email through Postmark's API from `src/email/send.mjs`. Templates stay in this repository,
in `templates/email/`, as plain text with `{{placeholders}}`, so a copy change is reviewed like any other change.

## Consequences

Delivery and bounce reports are in Postmark. The API key is in the deploy environment, never in the repository.
MD
cat > docs/api-changelog.md <<'MD'
# API changelog

What changed for clients of the Juniper Books API, newest first.

## Unreleased

## 4.2.0 (2026-10-27)

- Added `GET /v1/books/{id}/editions`.

## 4.1.0 (2026-09-29)

- Added `format` to the book object: `hardback`, `paperback` or `ebook`.
MD
cat > openapi.yaml <<'YAML'
openapi: 3.1.0
info:
  title: Juniper Books API
  version: 4.2.0
paths:
  /v1/books/{id}:
    get:
      summary: One book
      responses:
        '200': { description: The book }
  /v1/books/{id}/editions:
    get:
      summary: Every edition of a book
      responses:
        '200': { description: The editions }
  /v1/account/password-reset:
    post:
      summary: Email a password-reset link
      responses:
        '202': { description: The email is on its way, if the address has an account }
YAML
cat > package.json <<'JSON'
{
  "name": "juniper-api",
  "version": "4.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.mjs",
    "test": "node --test"
  }
}
JSON
printf 'node_modules/\n.env\n' > .gitignore
cat > db/migrations/0001_accounts.sql <<'SQL'
CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL
cat > src/api/routes.mjs <<'JS'
import { sendTemplate } from '../email/send.mjs';

export const routes = {
  'POST /v1/account/password-reset': async ({ body, accounts, links }) => {
    const account = await accounts.byEmail(body.email);
    if (account) await sendTemplate('password-reset', account.email, { name: account.name, reset_link: await links.reset(account) });
    return { status: 202 };
  },
};
JS
cat > src/email/send.mjs <<'JS'
import { readFileSync } from 'node:fs';

// Fills a template from templates/email/ and hands it to the mail provider (see docs/adr/0004-transactional-email.md).
export function render(name, values) {
  const text = readFileSync(new URL(`../../templates/email/${name}.txt`, import.meta.url), 'utf8');
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw Error(`template ${name} needs ${key}`);
    return values[key];
  });
}

export async function sendTemplate(name, to, values, provider = globalThis.mailProvider) {
  return provider.send({ to, text: render(name, values) });
}
JS
cat > templates/email/password-reset.txt <<'TXT'
Hi {{name}},

We got a request to reset the password for your Juniper Books account. You will recieve a new link each time you ask,
and each link works for 30 minutes.

Reset your password: {{reset_link}}

If you did not ask for this, you can ignore this email: your password stays the same.

The Juniper Books team
TXT
cat > templates/email/welcome.txt <<'TXT'
Hi {{name}},

Welcome to Juniper Books. Your account is ready, and your first order ships free.

The Juniper Books team
TXT
cat > test/email.test.mjs <<'JS'
import assert from 'node:assert/strict';
import test from 'node:test';
import { render } from '../src/email/send.mjs';

test('every placeholder of the password-reset email is filled', () => {
  const text = render('password-reset', { name: 'Ada', reset_link: 'LINK' });
  assert.match(text, /^Hi Ada,$/m);
  assert.match(text, /Reset your password: LINK$/m);
  assert.doesNotMatch(text, /\{\{/);
});

test('a missing value is refused', () => {
  assert.throws(() => render('welcome', {}), /needs name/);
});
JS
git init -q -b main
git config user.name "Contractor"
git config user.email "contractor@example.invalid"
# Inside Claude Code's sandbox the folder also holds an entry that cannot be opened over each name the sandbox
# protects (Claude Code 2.1.322). Git leaves them out, so git status stays clean and git add -A works there too.
mkdir -p .git/info
printf '%s\n' /.bash_profile /.bashrc /.claude/ /.eval-artifacts /.gitconfig /.gitmodules /.idea /.mcp.json /.profile /.ripgreprc /.vscode /.zprofile /.zshrc >> .git/info/exclude
git add -A && git commit -qm "juniper-api 4.2.0"
