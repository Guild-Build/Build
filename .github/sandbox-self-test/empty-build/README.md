# Sandbox self-test build

An empty build. The Season trial workflow's sandbox self-test (`.github/scripts/sandbox-self-test.mjs`) runs it on the
one-case trial in `../trial`, with a stand-in for the model on 127.0.0.1, to prove that the agent's own Bash tool can
start a command inside the sandbox on the runner before anything is spent. It is not a guild build and is never
published.
