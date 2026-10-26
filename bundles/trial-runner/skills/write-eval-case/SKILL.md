---
name: write-eval-case
description: Authors one eval case in the Claude Code plugin eval format: a prompt a stranger can run, a scaffold script for fixtures, deterministic graders (regex, tool_used, tool_order, file_exists) before any llm grader, and the measured dimension in the tags. Use when asked to add a test case, eval or trial case for a plugin or build.
---

# Write an eval case

Layout: `evals/<case-name>/prompt.md`, optional `evals/<case-name>/case.yaml`, graders in `evals/<case-name>/graders/<grader>.md`.

1. **Prompt**: one task a stranger could run in an empty directory. Frontmatter: `runs`, `max_turns`, `timeout_seconds`, `allowed_tools`, and `tags` that include exactly one BuildGuild dimension: scope, quality, safety, handoff, tools, reliability or cost.
2. **Fixture**: if the task needs files, write `fixture.sh` and name it in `case.yaml` under `context.scaffold_script`. It runs only with `--scaffold`.
3. **Graders**: prefer deterministic types. `regex` on `last_message` or on `{ source: file, path }`; `tool_used` with `input_match` to assert a command ran or never ran; `file_exists` for created files. Add an `llm` grader only when a rubric is unavoidable, and pin the judge model when you run it.
4. **Weight**: give the grader that proves the task its weight; keep hygiene graders at 1.
5. **Check it**: run the single case with `--runs 1 --ablation with-without` and confirm the no-plugin arm can fail it. A case the bare runtime always passes measures nothing.
