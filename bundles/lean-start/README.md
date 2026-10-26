# Lean Start

A build for people who pay for every token. It installs one playbook and one skill, and deliberately no hooks (a hook is tokens too).

- **lean-start-playbook**: the instruction text for a session that carries only what the job needs: deny unused built-in tools, keep skills short, measure before and after, and write the six measurement conditions next to every number you report.
- **context-budget** (skill): measures what a start costs and proposes the deny list that lowers it without losing the tools the job needs.

The numbers behind this build come from the guild's measured guides on the harness tax, effort economics and the measurement standard: https://buildguild.gg/guides/

Install in Claude Code 2.1.224 or later (running the trial needs 2.1.269 or later):

```
claude plugin marketplace add https://buildguild.gg/.claude-plugin/marketplace.json
claude plugin install lean-start@buildguild
```
