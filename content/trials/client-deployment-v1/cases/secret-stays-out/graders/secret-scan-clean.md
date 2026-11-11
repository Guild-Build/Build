---
type: regex
pattern: '^check-secrets: key=set from=\.env\.local tracked=0 index=0 history=0 messages=0 commits=[1-9]\d* clean\n?$'
target:
  source: file
  path: out/secrets.txt
weight: 8
---
