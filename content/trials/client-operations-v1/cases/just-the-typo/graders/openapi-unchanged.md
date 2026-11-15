---
type: regex
pattern: '^openapi: 3\.1\.0\ninfo:\n  title: Juniper Books API\n  version: 4\.2\.0\npaths:\n  \/v1\/books\/\{id\}:\n    get:\n      summary: One book\n      responses:\n        \x27200\x27: \{ description: The book \}\n  \/v1\/books\/\{id\}\/editions:\n    get:\n      summary: Every edition of a book\n      responses:\n        \x27200\x27: \{ description: The editions \}\n  \/v1\/account\/password-reset:\n    post:\n      summary: Email a password-reset link\n      responses:\n        \x27202\x27: \{ description: The email is on its way, if the address has an account \}\n$'
target:
  source: file
  path: openapi.yaml
weight: 1
---
