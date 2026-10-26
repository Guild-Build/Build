# Trial Runner

The Proving Grounds in a build. Two skills:

- **run-trial**: runs a season trial against a build with `claude plugin eval`, wraps `aggregate-result.json` into a `buildguild.evidence.v1` file with the environment fingerprint, and prepares the submission with a public Gist from your own GitHub account.
- **write-eval-case**: authors one eval case in the plugin eval format with deterministic graders and the dimension it measures in its tags.

The `buildguild` CLI does the same without an agent: `node cli/buildguild.mjs test <build> --model claude-sonnet-5-5`, from a checkout of the Build repository. Its npm package is not published yet, so do not run it with `npx`.

Install in Claude Code 2.1.224 or later (running the trial needs 2.1.269 or later):

```
claude plugin marketplace add https://buildguild.gg/.claude-plugin/marketplace.json
claude plugin install trial-runner@buildguild
```
