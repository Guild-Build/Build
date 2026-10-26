#!/usr/bin/env bash
# Stop hook: if the working tree has uncommitted changes, ask the agent to commit or explain in the handoff.
# Exit 0 always; the message is advisory and reaches the agent through systemMessage.
set -u
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    printf '{"systemMessage":"Uncommitted changes remain in the working tree. Commit them with a behaviour-describing message, or state in the handoff note why the tree is left dirty."}\n'
  fi
fi
exit 0
