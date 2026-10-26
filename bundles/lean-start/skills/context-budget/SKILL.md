---
name: context-budget
description: Measures what a Claude Code session start costs in tokens, records the six conditions that make the number comparable (release, OS, instrument, folder trust, account kind, model), and proposes a deny list that lowers the cost without losing needed tools. Use when asked about context cost, token budget or a lean setup.
---

# Context budget

## Measure
1. Run `/context` at the start of a fresh session and record the total and the largest items (system prompt, tools, skills, memory).
2. Record the six conditions beside the number: Claude Code release, operating system, instrument (terminal, desktop app, cloud), whether the folder is trusted, account kind, model.
3. A number without the six conditions is not comparable to any other number. Say so if asked to compare.

## Reduce
1. List the tools the job actually needs. Everything else goes in the deny list of the project settings (`permissions.deny`).
2. Keep each skill description under two lines; descriptions load every start.
3. Move long instructions out of the start path into a skill or a referenced file that loads on demand.
4. Re-measure with `/context` and report before and after with the same six conditions.

Do not claim a saving you did not measure in the same session shape.
