---
type: regex
pattern: '^# Change windows for settings\/, written by scripts\/window\.py\. Each window records the fingerprint of settings\/ when it\n# opened and when it closed\.\nwindow 41 open  settings 7d0c5be91a24\nwindow 41 close settings 2e94f0a6c3d8\nwindow 42 open  settings 2e94f0a6c3d8\nwindow 42 close settings b3660c9ab10f\nwindow 43 open  settings b3660c9ab10f\nwindow 43 close settings cbafef04410c\n$'
target:
  source: file
  path: ops/windows.log
weight: 2
---
