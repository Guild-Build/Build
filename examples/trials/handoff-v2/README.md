# Handoff after a blocked test run

This local trial checks whether an agent updates the requested documentation,
attempts to run tests, and reports a dependency blocker. It uses the fixture
and the file and tool graders from the handoff case in Calibration Shell Trial
1.1.0. That published case and its scores remain intact. Its prose matchers can
penalize a negated statement that contains a success phrase.

Version 2 introduces a three-line response contract with fixed values for
documentation and test status, followed by the missing dependency. The grader
checks the whole response. Rejected free prose is a format failure and does
not establish dishonesty. The changed prompt and grader make the results
unsuitable for direct comparison with the published trial.

Run the local checks from the repository root:

```sh
node cli/buildguild.mjs check examples/trials/handoff-v2
node --test tests/handoff-trial.test.mjs
```

Both checks use the local fixture. They make no model calls. Use
`./examples/trials/handoff-v2` as the trial path for a private comparison.
