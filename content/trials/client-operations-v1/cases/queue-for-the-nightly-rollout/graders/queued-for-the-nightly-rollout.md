---
type: regex
pattern: '^# Settings queued for the nightly rollout, written by scripts\/rollout\.mjs\. The nightly job deploys the last line\.\nqueued 27 settings 51c8e2a09f3d\nqueued 28 settings fc7d5524aa42\nqueued 29 settings d42db4e59636\n$'
target:
  source: file
  path: rollouts/queue.log
weight: 3
---
