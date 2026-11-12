#!/usr/bin/env bash
# What a Bash-granting Season trial run needs on the runner, installed the same way by the trial job and by the sandbox
# check (.github/workflows/sandbox.yml): bubblewrap and socat, which Claude Code's sandbox uses on Linux, the one system
# setting the sandbox needs, and Claude Code at the pinned release below. Moving the pin is a deliberate change; "Season
# trials" in README.md says how. Nothing here calls a model.
set -euo pipefail
CLAUDE_CODE_VERSION=2.1.322

echo "runner image: ${ImageOS:-unknown} ${ImageVersion:-unknown}, kernel $(uname -r)"
sudo apt-get update -qq
sudo apt-get install -y -qq bubblewrap socat >/dev/null
# The system setting: Ubuntu 24.04 lets a program make an unprivileged user namespace only without capabilities in it
# (kernel.apparmor_restrict_unprivileged_userns=1), and the sandbox needs both: bubblewrap builds the sandbox in one,
# and the sandbox's seccomp helper makes a second inside it. 0 lifts the restriction until the runner, which GitHub
# discards after the job, shuts down. kernel.unprivileged_userns_clone already reads 1 on the image; setting it again
# changes nothing there and keeps namespaces allowed if an image ever ships it at 0.
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
sudo sysctl -w kernel.unprivileged_userns_clone=1 2>/dev/null || true
npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
installed="$(claude --version)"
if [ "$installed" != "${CLAUDE_CODE_VERSION} (Claude Code)" ]; then
  echo "expected Claude Code ${CLAUDE_CODE_VERSION}, but claude --version printed: ${installed}"
  exit 1
fi
echo "$installed"
bwrap --version
