# Measured Delivery

A build for everyday repository work with a coding agent. It installs three skills, one read-only subagent and one hook:

- **test-first**: find or write the failing test before changing behaviour; never call work done while a relevant test is red or unrun.
- **commit-discipline**: commits describe observable behaviour, one change per commit, never on the default branch, never with secrets.
- **handoff-note**: every piece of work ends with five lines a human can act on: what changed, what was verified and how, what was not verified, the one next step.
- **scout** (agent): maps a repository or question before anyone edits. Read-only.
- **uncommitted-work-check** (Stop hook): when the agent stops with uncommitted changes, it is told to commit or to say in the handoff why the tree is left dirty.

Install in Claude Code 2.1.224 or later (running the trial needs 2.1.269 or later):

```
claude plugin marketplace add https://buildguild.gg/.claude-plugin/marketplace.json
claude plugin install measured-delivery@buildguild
```

Trial: Guild Smoke Trial v1. Evidence and tier: https://buildguild.gg/builds/measured-delivery/
