#!/usr/bin/env bash
# SessionStart hook. When a session starts in a repository, it looks for the repository's own operating documents by
# conventional names (agent instructions, a runbook, a contributing guide, and any of these a README points to) and
# adds a few lines to the agent's context: which documents it found, to read the ones that govern the requested change
# before changing anything, to run the checks they name, and to say in its reply which it read. It also lists the other
# documentation files the README names (ending in .md, .markdown, .rst, .txt or .adoc, but not the license, notice,
# code of conduct, security or authors file, nor the README itself) and the folders it names that hold only such files
# and subfolders; those come after the documents found by convention and take neither their place nor their room in the
# text. It adds nothing when it finds none. A document or the README counts only when it is a regular file that is not
# a symbolic link and no folder on its path below the top folder is one. It lists at most eight documents and counts any
# more. The text never exceeds 1,200 characters. It reads file names and the first 64 KB of the README only (it opens no
# other file, and looks at no more than the first 201 entries of a named folder, by name and type), writes nothing,
# makes no network or model call, and exits 0 whatever happens, so it never fails a session. Bash 3.2 or later, with
# head, grep, tr and ls; git is used when present to find the top folder.
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

# What has been found so far is what 0.1.0 lists: the documents in paths and the ones counted in extras.
old_docs=${#paths[@]}
old_extra=${#extras[@]}

# Then what else the README names, in order of first appearance: files that end in a documentation ending, and folders
# of such files. A name is a whole run of the characters A-Z a-z 0-9 . _ / - that holds a / or a documentation ending;
# it is a folder name when it ends in /, and otherwise a file name when, without the periods that end it (a sentence
# may end right after it), it ends in an ending. The first 20 distinct file names and the first 20 distinct folder
# names count, each with a leading ./ dropped, whether or not they are then listed. An absolute name (so any name in a
# web address, which follows a /) or one holding .. is refused. The README's own entry above is not changed by these.

# True when the name ends in one of the documentation endings, case ignored.
doc_ending() {
  local r=1
  shopt -s nocasematch
  case "$1" in *.md|*.markdown|*.rst|*.txt|*.adoc) r=0 ;; esac
  shopt -u nocasematch
  return "$r"
}
# True when the file's name without its ending, case ignored, is that of a legal or community file.
not_operating() {
  local stem="${1##*/}" r=1
  stem="${stem%.*}"
  shopt -s nocasematch
  case "$stem" in license|licence|copying|notice|code_of_conduct|code-of-conduct|security|authors) r=0 ;; esac
  shopt -u nocasematch
  return "$r"
}
# True when the path below the root names a folder that is not a symbolic link, with no symbolic link on the way to it,
# and every entry directly in it, hidden ones included, is a folder (not entered) or a regular file with a
# documentation ending, at least one of them such a file, and it has at most 200 entries. Entries are tested by name
# and type only: no file in it is opened.
# A glob would read the whole folder before the 200-entry limit could stop it, and Bash 5 takes tens of microseconds
# per entry to do so. So the entries come from ls, unsorted (-f, which also lists . and ..), one per line, with any
# character that cannot be printed shown as ? (-q), and head stops after 203 lines: . and .. and 201 entries. A name
# that ls cannot print names no entry, so it leaves the folder out. Colour and quoting set in the environment are
# cleared for ls, so that it prints the names alone.
doc_folder() {
  local rest="$1" path="$root" part entries name e n=0 docs=0 r=0
  case "$rest" in ''|/*|*/|*//*|*..*) return 1 ;; esac
  while :; do
    part="${rest%%/*}"
    path="$path/$part"
    [ -L "$path" ] && return 1
    [ "$part" = "$rest" ] && break
    rest="${rest#*/}"
  done
  [ -d "$path" ] || return 1
  entries="$(unset CLICOLOR CLICOLOR_FORCE QUOTING_STYLE; ls -1 -f -q "$path" 2>/dev/null | head -n 203)"
  while IFS= read -r name; do
    case "$name" in ''|.|..) continue ;; esac
    n=$((n + 1))
    e="$path/$name"
    if [ "$n" -gt 200 ] || [ -L "$e" ]; then r=1; break; fi
    [ -d "$e" ] && continue
    if [ -f "$e" ] && doc_ending "$name"; then docs=$((docs + 1)); else r=1; break; fi
  done <<EOF
$entries
EOF
  [ "$r" -eq 0 ] && [ "$docs" -gt 0 ]
}
# Adds a folder once, as add_doc adds a document: after the first eight it is only counted.
add_folder() {
  local q
  for q in "${paths[@]}"; do [ "$root/$q" -ef "$root/$1" ] && return 0; done
  for q in "${extras[@]}"; do [ "$root/$q" -ef "$root/$1" ] && return 1; done
  if [ "${#paths[@]}" -ge 8 ]; then extras+=("$1/"); return 1; fi
  paths+=("$1/")
  kinds+=('folder of documents, named in the README')
}
if [ -n "$readme" ]; then
  names="$(head -c 65536 "$root/$readme" 2>/dev/null | grep -a -o -i -E '[A-Za-z0-9._/-]*(/|\.(md|markdown|rst|txt|adoc))[A-Za-z0-9._/-]*' 2>/dev/null)"
  files='|'
  folders='|'
  nfiles=0
  nfolders=0
  while IFS= read -r name; do
    [ "$nfiles" -ge 20 ] && [ "$nfolders" -ge 20 ] && break
    ref="${name#./}"
    case "$name" in
      */)
        ref="${ref%/}"
        case "$folders" in *"|$ref|"*) continue ;; esac
        [ "$nfolders" -lt 20 ] || continue
        folders="$folders$ref|"
        nfolders=$((nfolders + 1))
        doc_folder "$ref" && add_folder "$ref"
        ;;
      *)
        # A sentence may end right after a file name: the periods that end the name are not part of it.
        while :; do case "$ref" in *.) ref="${ref%.}" ;; *) break ;; esac; done
        doc_ending "$ref" || continue
        case "$files" in *"|$ref|"*) continue ;; esac
        [ "$nfiles" -lt 20 ] || continue
        files="$files$ref|"
        nfiles=$((nfiles + 1))
        not_operating "$ref" && continue
        plain_file "$ref" || continue
        [ "$root/$ref" -ef "$root/$readme" ] && continue
        add_doc "$ref" 'named in the README'
        ;;
    esac
  done <<EOF
$names
EOF
fi

[ "${#paths[@]}" -gt 0 ] || exit 0
# The entries 0.1.0 lists: its documents, then the README's own entry.
items=()
i=0
while [ "$i" -lt "$old_docs" ]; do
  items+=("${paths[$i]} (${kinds[$i]})")
  i=$((i + 1))
done
own=""
[ -n "$pointed" ] && own="$readme (points to $pointed)" && items+=("$own")
# The entries the README's other names add, in the order it names them, and how many it found beyond the eight listed.
added=()
while [ "$i" -lt "${#paths[@]}" ]; do
  added+=("${paths[$i]} (${kinds[$i]})")
  i=$((i + 1))
done
added_extra=$(( ${#extras[@]} - old_extra ))
extra=$old_extra
# The fixed sentences take 200 characters, so the list may take 1,000 and the text stays within 1,200. Documents found
# beyond the eight listed are counted in an ending ", and N more". When the whole list does not fit, the entries that
# fit are kept in order, each whole: an entry stays when it fits after the entries kept before it (with ", " only when
# one precedes it) together with that ending, whose N counts every entry and document left out. N is known only at the
# end, so the ending (11 characters and N's digits) is sized for a one-digit N, and again for two digits if N reaches 10.
# This is the list 0.1.0 writes, from 0.1.0's entries alone; shown holds the entries it keeps and more its N.
budget=1000
list=""
shown=("${items[@]}")
more=$extra
for item in "${items[@]}"; do list="${list:+$list, }$item"; done
[ "$extra" -gt 0 ] && list="$list, and $extra more"
if [ "${#list}" -gt "$budget" ]; then
  for digits in 1 2; do
    kept=""
    shown=()
    more=$extra
    for item in "${items[@]}"; do
      next="${kept:+$kept, }$item"
      if [ $(( ${#next} + 11 + digits )) -le "$budget" ]; then kept="$next"; shown+=("$item"); else more=$((more + 1)); fi
    done
    [ "${#more}" -le "$digits" ] && break
  done
  if [ -n "$kept" ]; then list="$kept, and $more more"; else list="$more, with names too long to list"; fi
fi
# The added entries take only the room that list leaves. Every entry it shows stays, whole and in its order, with the
# README's own entry last; the added entries go between the documents and the README's entry, each one that fits after
# the ones kept before it together with the ending, by the same rule; and N counts every document and entry left out,
# added ones included. When even that N does not fit beside what the list shows, the list stays as 0.1.0 writes it,
# and the added entries are neither listed nor counted. When there is no added entry, it stays as 0.1.0 writes it.
if [ "${#added[@]}" -gt 0 ] || [ "$added_extra" -gt 0 ]; then
  docs=""
  last=""
  for item in "${shown[@]}"; do
    if [ -n "$own" ] && [ "$item" = "$own" ]; then last="$item"; else docs="${docs:+$docs, }$item"; fi
  done
  # Sets the variable out to the list: the documents shown, the added entries in $1, the README's own entry if shown,
  # and the ending for the count $2 (none when it is 0).
  compose() {
    out="$docs"
    [ -n "$1" ] && out="${out:+$out, }$1"
    [ -n "$last" ] && out="${out:+$out, }$last"
    if [ "$2" -gt 0 ]; then
      if [ -n "$out" ]; then out="$out, and $2 more"; else out="$2, with names too long to list"; fi
    fi
  }
  all=""
  for item in "${added[@]}"; do all="${all:+$all, }$item"; done
  compose "$all" $((more + added_extra))
  if [ "${#out}" -gt "$budget" ]; then
    # At most 31 of 0.1.0's documents and entries and 40 added ones can be left out, so N has one or two digits.
    for digits in 1 2; do
      picked=""
      left=$((more + added_extra))
      for item in "${added[@]}"; do
        compose "${picked:+$picked, }$item" 0
        if [ $(( ${#out} + 11 + digits )) -le "$budget" ]; then picked="${picked:+$picked, }$item"; else left=$((left + 1)); fi
      done
      [ "${#left}" -le "$digits" ] && break
    done
    compose "$picked" "$left"
  fi
  [ "${#out}" -le "$budget" ] && list="$out"
fi
# Every listed name is made of letters, digits and . _ / - only, so the text needs no escaping inside JSON.
text="Operating documents in this repository: $list.\\nBefore you change anything, read the ones that govern the requested change.\\nRun the checks they name, and say in your reply which of these documents you read."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$text"
