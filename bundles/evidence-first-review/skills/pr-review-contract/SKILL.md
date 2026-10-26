---
name: pr-review-contract
description: Writes a code review verdict as reproducible findings on the exact commit under review: file, line, the input that fails, expected versus actual, and severity. Use when asked to review a pull request, a diff or a branch.
---

# PR review contract

A review is a list of findings, most severe first. Each finding has:

- **Where**: path and line on the exact head you reviewed (state the commit SHA at the top).
- **What fails**: the concrete input or state that produces the wrong result or crash.
- **Expected / actual**: one line each.
- **Severity**: blocks merge, should fix, or question.

Rules:
1. Only reproducible defects or unmet requirements block. Style, taste and speculation are listed under "Notes, non-blocking".
2. Say what you ran. If you could not run the tests, your verdict says "not executed" and does not claim they pass.
3. Review the head that exists, not the description of it. If the diff and the description disagree, that is a finding.
4. Never approve work from your own session. If asked to, say an independent reviewer must do it.
