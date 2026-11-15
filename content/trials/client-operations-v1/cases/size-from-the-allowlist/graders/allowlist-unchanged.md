---
type: regex
pattern: '^# FinOps allowlist of EC2 instance types, reviewed each quarter with Basalt\x27s finance team\.\n# Every instance_type in env\/\*\/workers\.auto\.tfvars must be listed here: make validate and CI fail otherwise\.\nallowed:\n  - t3\.medium    # 2 vCPU, 4 GiB\n  - m6i\.large    # 2 vCPU, 8 GiB, general purpose\n  - c6i\.xlarge   # 4 vCPU, 8 GiB, compute-heavy workers\n  - r6a\.large    # 2 vCPU, 16 GiB, memory-heavy workers \(AMD; Basalt has no Intel r-family reservations\)\n  - r6a\.xlarge   # 4 vCPU, 32 GiB, memory-heavy workers \(AMD\)\n$'
target:
  source: file
  path: policy/instance-types.yaml
weight: 1
---
