#!/usr/bin/env bash
# SessionStart hook. When a session starts in a repository, it looks for the repository's own operating documents by
# conventional names (agent instructions, a runbook, a contributing guide, and any of these a README points to) and
# adds a few lines to the agent's context: which documents it found, to read the ones that govern the requested change
# before changing anything, to run the checks they name, and to say in its reply which it read. It adds nothing when it
# finds none. A document or the README counts only when it is a regular file that is not a symbolic link and no folder
# on its path below the top folder is one. It lists at most eight documents and counts any more. The text never exceeds
# 1,200 characters. It reads file names and the first 64 KB of the README only, writes nothing, makes no network or
# model call, and exits 0 whatever happens, so it never fails a session. Bash 3.2 or later, with head, grep and tr; git is used when present to find the top folder.
trap 'exit 0' EXIT

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
root="$(cd "$dir" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$root" ] && [ -d "$root" ] || root="$dir"

# Conventional names, in the order they are listed: name|kind.
candidates='AGENTS.md|agent instructions
CLAUDE.md|agent instructions
.github/copilot-instructions.md|agent instructions
RUNBOOK.md|runbook
runbook.md|runbook
docs/RUNBOOK.md|runbook
docs/runbook.md|runbook
CONTRIBUTING.md|contributing guide
docs/CONTRIBUTING.md|contributing guide
.github/CONTRIBUTING.md|contributing guide'

# True when the path below the root names a readable regular file that is not a symbolic link, and no folder on the
# way to it below the root is one: a link is skipped even when it points inside the repository. Only file tests are
# used, so nothing is opened.
plain_file() {
  local rest="$1" path="$root" part
  case "$rest" in ''|/*|*/|*//*|*..*) return 1 ;; esac
  while :; do
    part="${rest%%/*}"
    path="$path/$part"
    [ -L "$path" ] && return 1
    [ "$part" = "$rest" ] && break
    rest="${rest#*/}"
  done
  [ -f "$path" ] && [ -r "$path" ]
}

paths=()
kinds=()
extras=()
# Adds a document once: a plain file (above) that is not the same file as one already found (on a case-insensitive
# disk RUNBOOK.md and runbook.md are one file). The first eight are listed and any more only counted. Anything else,
# such as a link, a device, a pipe or a folder, is left out. Succeeds when the document is listed.
add_doc() {
  local q
  plain_file "$1" || return 1
  for q in "${paths[@]}"; do [ "$root/$q" -ef "$root/$1" ] && return 0; done
  for q in "${extras[@]}"; do [ "$root/$q" -ef "$root/$1" ] && return 1; done
  if [ "${#paths[@]}" -ge 8 ]; then extras+=("$1"); return 1; fi
  paths+=("$1")
  kinds+=("$2")
}
while IFS='|' read -r name kind; do add_doc "$name" "$kind"; done <<EOF
$candidates
EOF

# The README counts when it points to an operating document: by its path, or by the file name of one found above.
readme=""
for r in README.md README readme.md Readme.md README.markdown; do
  if plain_file "$r"; then readme="$r"; break; fi
done
pointed=""
if [ -n "$readme" ]; then
  refs="$(head -c 65536 "$root/$readme" 2>/dev/null | grep -a -o -i -E '([A-Za-z0-9._-]+/)*(runbook|contributing|agents|claude|copilot-instructions)[A-Za-z0-9._-]*\.md' 2>/dev/null | head -n 20)"
  while IFS= read -r ref; do
    ref="${ref#./}"
    case "$ref" in ''|/*|*..*) continue ;; esac
    target=""
    if plain_file "$ref"; then
      case "$(printf '%s' "$ref" | tr 'A-Z' 'a-z')" in
        *runbook*) kind='runbook' ;;
        *contributing*) kind='contributing guide' ;;
        *) kind='agent instructions' ;;
      esac
      add_doc "$ref" "$kind" && target="$ref"
      for q in "${paths[@]}"; do [ "$root/$q" -ef "$root/$ref" ] && target="$q"; done
    else
      for q in "${paths[@]}"; do [ "${q##*/}" = "${ref##*/}" ] && target="$q"; done
    fi
    [ -n "$target" ] || continue
    case ", $pointed, " in *", $target, "*) ;; *) pointed="${pointed:+$pointed, }$target" ;; esac
  done <<EOF
$refs
EOF
fi

[ "${#paths[@]}" -gt 0 ] || exit 0
items=()
i=0
while [ "$i" -lt "${#paths[@]}" ]; do
  items+=("${paths[$i]} (${kinds[$i]})")
  i=$((i + 1))
done
[ -n "$pointed" ] && items+=("$readme (points to $pointed)")
extra=${#extras[@]}
# The fixed sentences take 200 characters, so the list may take 1,000 and the text stays within 1,200. Documents found
# beyond the eight listed are counted in an ending ", and N more". When the whole list does not fit, the entries that
# fit are kept in order, each whole: an entry stays when it fits after the entries kept before it (with ", " only when
# one precedes it) together with that ending, whose N counts every entry and document left out. N is known only at the
# end, so the ending (11 characters and N's digits) is sized for a one-digit N, and again for two digits if N reaches 10.
budget=1000
list=""
for item in "${items[@]}"; do list="${list:+$list, }$item"; done
[ "$extra" -gt 0 ] && list="$list, and $extra more"
if [ "${#list}" -gt "$budget" ]; then
  for digits in 1 2; do
    kept=""
    more=$extra
    for item in "${items[@]}"; do
      next="${kept:+$kept, }$item"
      if [ $(( ${#next} + 11 + digits )) -le "$budget" ]; then kept="$next"; else more=$((more + 1)); fi
    done
    [ "${#more}" -le "$digits" ] && break
  done
  if [ -n "$kept" ]; then list="$kept, and $more more"; else list="$more, with names too long to list"; fi
fi
# Every listed name is made of letters, digits and . _ / - only, so the text needs no escaping inside JSON.
text="Operating documents in this repository: $list.\\nBefore you change anything, read the ones that govern the requested change.\\nRun the checks they name, and say in your reply which of these documents you read."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$text"
