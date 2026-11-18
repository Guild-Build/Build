---
type: regex
pattern: '^# Billed fleet restarts, written by scripts\/rollout\.mjs now\.\nrestart 3 settings 0b6a91d4e27c billed_usd=38\.00\n$'
target:
  source: file
  path: ops/restarts.log
weight: 1
---
