# Measured Writing Desk

The workflow the guild uses for its own measured guides, as a build:

- **measured-article** (skill): structure of a measured article: direct answer first, the method beside each result, a "how we know" section with sample size and limits, and a "cite this" block.
- **source-ledger** (skill): a ledger of every source cited: location, the exact claim it supports, date read, whether a second source agrees. No number without a row.
- **fact-checker** (agent): read-only; reports every claim it cannot trace to the ledger, every number without a method, every disagreement between sources.

Install in Claude Code 2.1.224 or later (running the trial needs 2.1.269 or later):

```
claude plugin marketplace add https://buildguild.gg/.claude-plugin/marketplace.json
claude plugin install measured-writing-desk@buildguild
```
