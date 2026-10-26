---
name: test-first
description: Before changing behaviour in a repository, find or write the test that fails, run it, make it pass, run it again. Use whenever asked to fix, change or add behaviour in code that has or should have tests.
---

# Test first

1. Find the test that covers the behaviour. If none exists, write the smallest one that fails for the right reason.
2. Run it and show the failure. A test that passes before the change proves nothing.
3. Make the change. Touch only what the failing test needs.
4. Run the test again, then the suite that contains it. Paste the command and the last lines of output in your reply.
5. If a relevant test is red or you could not run it, say so plainly. Never report "done" over a red or unrun test.

Rules: do not change a failing test to make it pass unless the test itself is wrong, and say so when you do. Prefer the repository's own test command (package.json scripts, Makefile, pytest, cargo test) over an ad-hoc one.
