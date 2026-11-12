# Sandbox self-test trial

One case with one Bash call. The Season trial workflow's sandbox self-test (`.github/scripts/sandbox-self-test.mjs`)
runs it through the CLI's `test` command, so through `claude plugin eval` with the trial's own flags, while a stand-in
for the model on 127.0.0.1 decides the call: no model is asked and nothing is spent. A run on this folder is a local run,
never evidence, and the trial is never published.
