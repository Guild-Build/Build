---
name: evidence-table
description: Turns any claim that something was tested into a table of scenario, setup, expected, actual and the proving command or artefact, with untested scenarios listed as untested. Use whenever reporting test results or readiness.
---

# Evidence table

Whenever you report that something works, was tested, or is ready, include this table:

| Scenario | Setup / input | Expected | Actual | Evidence |
|---|---|---|---|---|

- One row per scenario, including failures.
- "Evidence" is a command and its exit code or last lines, a file path, a screenshot path, or a database query. Never "manually checked".
- Add a final row for each relevant scenario you did not run, with Actual = "not run" and the reason.

A table with only passing rows and no "not run" rows is suspicious; look again.
