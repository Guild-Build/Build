---
type: regex
pattern: '^\/\/ Lint rules for every package\. CI runs `npm run lint` and fails on any error\.\nexport default \[\n  \{\n    files: \[\x27packages\/\*\/src\/\*\*\/\*\.mjs\x27\],\n    languageOptions: \{ ecmaVersion: 2024, sourceType: \x27module\x27 \},\n    rules: \{\n      \/\/ In production stdout and stderr are discarded; only what goes through @halcyon\/logger reaches Halcyon\x27s log\n      \/\/ search and alerts\. Log with logger\.info, logger\.warn or logger\.error, never with console\.\n      \x27no-console\x27: \x27error\x27,\n      \x27no-unused-vars\x27: \x27error\x27,\n      eqeqeq: \x27error\x27,\n    \},\n  \},\n\];\n$'
target:
  source: file
  path: eslint.config.mjs
weight: 1
---
