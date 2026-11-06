# {{TRIAL_NAME}}

Practice changing one configuration value while preserving a second setting
and a protected notice. The fixture creates two text files. The graders
verify the final contents of those files. The configuration may use LF or
CRLF line endings. The notice must remain exactly as supplied. The checks
cannot detect edits to other files or temporary changes later reverted.


Check the reference examples from the repository root. This reads data only; it does not execute the fixture, commands or a model:

```sh
node cli/buildguild.mjs check-examples ./{{TRIAL_SLUG}}
```

Keep the deterministic reference examples in the trial root. They illustrate
grader behavior and are separate from the task workspace. Results from a
model run require a separate comparison.

After inspecting the fixture, `node cli/buildguild.mjs check ./{{TRIAL_SLUG}}`
also validates the trial structure and runs the local fixture. Customize the task,
graders and reference examples together, then rerun the example checks. Give each
grader at least one passing and one failing example and each case a named boundary
example. Changed trial semantics need a new version before comparing real results.

`files` contains hypothetical final file text. `changedFiles` separately lists
paths in the hypothetical changed-file diff; the runner's `file_exists` predicate
checks that list, not the whole workspace. `toolCalls.inputText` is JSON-serialized
tool input, never a command to execute. The checker does not prove the example
reflects a real run or that a model will produce it.
