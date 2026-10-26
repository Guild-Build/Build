#!/usr/bin/env bash
# PreToolUse hook on Bash: deny force pushes and pull-request merges from the authoring session.
# Reads the hook payload on stdin, extracts tool_input.command with a real JSON parser, and inspects
# only that string. Exit 2 blocks the call and sends the reason to the agent; exit 0 allows it.
set -u
input="$(cat)"
cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
elif command -v python3 >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)"
elif command -v node >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).tool_input?.command||""))}catch{}})' 2>/dev/null)"
fi
[ -z "$cmd" ] && exit 0
# Subshells and groups are read as the commands inside them, so (git push -f) and { git push -f; } count.
cmd="$(printf '%s' "$cmd" | tr '(){}' '    ')"
# A simple command pushes when its first git, bare or by path (but not a NAME=dir/git value), has push as its
# subcommand: the first word after git's global options. -C, -c, --git-dir, --work-tree, --namespace, --config-env,
# --super-prefix and --attr-source take the next word unless written with =; any other option is one word. Words
# after the subcommand are its arguments, so a commit message that mentions git push is not a push.
# Force is -f or a short-flag cluster containing f (-fu), any option that begins with --force (git accepts
# unambiguous abbreviations such as --force-w), --mirror or an abbreviation of it (--mirr), or a +refspec.
# Quote marks are dropped from each word after git before it is checked, so git push "--force" and git 'push' -f
# count. The git word itself is taken as written, so a command that only quotes the text (grep "git push -f") runs.
quotes="\"'"
git_word='^([^=]*/)?git$'
force_arg='^(-[A-Za-z]*f[A-Za-z]*|--force.*|--m(i(r(r(o(r)?)?)?)?)?|\+.+)$'
force_push() {
  local -a w
  local i=0 n arg
  read -r -a w <<< "$1"
  n=${#w[@]}
  while [ "$i" -lt "$n" ] && ! [[ ${w[i]} =~ $git_word ]]; do i=$((i + 1)); done
  i=$((i + 1))
  while [ "$i" -lt "$n" ]; do
    case ${w[i]//[$quotes]/} in
      -C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source) i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "$n" ] && [ "${w[i]//[$quotes]/}" = push ] || return 1
  for arg in "${w[@]:i+1}"; do
    [[ ${arg//[$quotes]/} =~ $force_arg ]] && return 0
  done
  return 1
}
# Each simple command (split at ; & | and newlines) is checked on its own, so a flag on one never blames another.
while IFS= read -r part; do
  if force_push "$part"; then
    echo "merge-guard: force pushes are blocked in this build. Push a new commit on a branch instead." >&2
    exit 2
  fi
done < <(printf '%s\n' "$cmd" | tr ';&|' '\n\n\n')
# gh pr merge; gh api on a pull's merge endpoint.
if printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])([^[:space:]]*/)?gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)|(^|[;&|[:space:]])([^[:space:]]*/)?gh[[:space:]]+api[[:space:]].*/pulls/[0-9]+/merge'; then
  echo "merge-guard: the authoring session may not merge. Hand the pull request to an independent reviewer and a separate merger." >&2
  exit 2
fi
exit 0
