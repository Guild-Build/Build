#!/usr/bin/env bash
# PreToolUse hook on Bash: deny force pushes and pull-request merges from the authoring session.
# Reads the hook payload on stdin, extracts tool_input.command with a real JSON parser, and inspects
# only that string. Exit 2 blocks the call and sends the reason to the agent; exit 0 allows it.
#
# The command is split into words the way bash does it, and each simple command is checked on its own. Commands that
# run inside it are checked as command lines of their own: command substitutions, the command string of bash, sh,
# zsh or dash -c, eval, and a here-document, here-string or pipe that a shell reads. Anything nested more than three
# levels deep is blocked.
#
# Known limits: the guard reads only the command's text, so it does not catch
# - git aliases, shell aliases and git config (an alias for push --force, a +refspec or mirror setting for a remote);
# - a git name or a command produced by a variable or by another command's output, such as $GIT push -f or
#   sh -c "$(cat cmd.txt)";
# - xargs, which builds the command it runs from its input;
# - scripts written to disk and run later;
# - merges by any route other than gh pr merge and gh api on a pull's merge endpoint (the GraphQL API, curl).
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

# The scan works on bytes, and [A-Za-z] below means ASCII letters.
LC_ALL=C
nl=$'\n'
tab=$'\t'
push_msg="merge-guard: force pushes are blocked in this build. Push a new commit on a branch instead."
merge_msg="merge-guard: the authoring session may not merge. Hand the pull request to an independent reviewer and a separate merger."
deep_msg="merge-guard: commands nested more than three levels deep are blocked in this build. Run the inner command directly."
deny() { echo "$1" >&2; exit 2; }
git_word='^([^=]*/)?git$'
gh_word='^([^=]*/)?gh$'
shell_word='^([^=]*/)?(bash|sh|zsh|dash)$'
force_arg='^(-[A-Za-z]*f[A-Za-z]*|--force.*|--m(i(r(r(o(r)?)?)?)?)?|\+.+)$'
merge_api='/pulls/[0-9]+/merge'
digits='^[0-9]+$'
# Outside quotes these end a run of plain characters: blanks, ; & | < > ( ), the word breakers { } `, quotes, \ $ #.
stop=$' \t;&|<>(){}`\'"\\\\$#'

# The text is read in pieces, so that no step copies more than a few kilobytes: S is the whole text, S_off where its
# next 4 KB block starts, B the unread rest of the current block, and T the unread piece (at most 256 characters, never
# a newline) of the current line.
# need N: let T hold N characters, unless the line ends first.
need() {
  local x
  while [ ${#T} -lt "$1" ]; do
    if [ -z "$B" ]; then
      [ "$S_off" -lt "$S_len" ] || return 0
      B=${S:S_off:4096}; S_off=$((S_off + 4096))
    fi
    case $B in "$nl"*) return 0 ;; esac
    x=${B%%"$nl"*}; x=${x:0:256}; T=$T$x; B=${B:${#x}}
  done
}
# The next character in c, a newline at the end of a line; status 1 at the end of the text.
getc() {
  if [ -n "$T" ]; then c=${T:0:1}; T=${T:1}; return 0; fi
  need 1
  if [ -n "$T" ]; then c=${T:0:1}; T=${T:1}; return 0; fi
  if [ -n "$B" ]; then B=${B:1}; c=$nl; return 0; fi
  c=''; return 1
}
# The rest of the current line in line, moving past its newline; status 1 when the text has ended.
read_line() {
  line=''
  while :; do
    line=$line$T; T=''
    need 1
    [ -n "$T" ] && continue
    if [ -n "$B" ]; then B=${B:1}; return 0; fi
    [ -n "$line" ]; return
  done
}
skip_line() {
  T=''; need 1
  while [ -n "$T" ]; do T=''; need 1; done
}

# Check $1 as a command line of its own at nesting level $2.
scan_source() {
  [ "$2" -gt 3 ] && deny "$deep_msg"
  local S=$1 S_off=0 S_len=${#1} B='' T='' HD_N=0 HD_DONE=0
  local -a HD_DELIM=() HD_QUOTED=() HD_STRIP=() HD_CMDS=()
  scan_cmds '' "$2"
}

# Read simple commands to the end of the text, or to the ) that closes a $( when $1 is ")". $3 is 1 inside $(( )).
scan_cmds() {
  local closer=$1 level=$2 arith=${3:-0} depth=${3:-0} c run
  [ "$level" -gt 3 ] && deny "$deep_msg"
  local W='' inword=0 quoted=0 meta=1 target='' hstrip=0 subs=0 subnames='' piped=0 pipe_shell=0 pipe_hd=$HD_N
  local -a words=() names=() hs=() ptext=()
  while :; do
    run=${T%%[$stop]*}
    if [ -n "$run" ]; then W=$W$run; inword=1; meta=0; T=${T:${#run}}; fi
    getc || break
    case $c in
      ' '|"$tab") end_word; meta=1 ;;
      # ; & | && || |& and newlines end a simple command. A newline after | continues the pipeline, so a shell may
      # still follow: its here-documents are read as commands.
      "$nl") end_word; end_cmd
             if [ "$piped" = 1 ]; then heredocs_are_commands; else end_pipe; fi
             read_heredocs; meta=1 ;;
      ';') end_word; end_cmd; end_pipe; meta=1 ;;
      '&') end_word; meta=1; need 2
           case $T in
             '&'*) T=${T:1}; end_cmd; end_pipe ;;
             '>>'*) T=${T:2}; target=r ;;
             '>'*) T=${T:1}; target=r ;;
             *) end_cmd; end_pipe ;;
           esac ;;
      '|') end_word; meta=1; need 1
           case $T in
             '|'*) T=${T:1}; end_cmd; end_pipe ;;
             *) [ "${T:0:1}" = '&' ] && T=${T:1}; end_cmd; piped=1 ;;
           esac ;;
      # Inside (( )) and $(( )), < and > compare and shift; they open no redirection or here-document.
      '<'|'>') if [ "$arith" -gt 0 ]; then end_word; else io_number; end_word; need 2; redirect; fi; meta=1 ;;
      # ( ) { } break words, so (git push -f) and { git push -f; } are read as the commands inside.
      '(') end_word; meta=1; need 1
           if [ "$arith" = 0 ] && [ "${T:0:1}" = '(' ]; then T=${T:1}; depth=$((depth + 2)); arith=$depth
           else depth=$((depth + 1)); fi ;;
      ')') end_word; meta=1
           if [ "$depth" -gt 0 ]; then depth=$((depth - 1)); [ "$arith" -gt "$depth" ] && arith=0
           elif [ "$closer" = ')' ]; then end_cmd; end_pipe; return 0; fi ;;
      '{'|'}') end_word; meta=0 ;;
      # A # that starts a word starts a comment, which ends at the newline.
      '#') if [ "$inword" = 0 ] && [ "$meta" = 1 ]; then skip_line; else W=$W'#'; inword=1; meta=0; fi ;;
      "'") single_quoted; quoted=1; inword=1; meta=0 ;;
      '"') quoted=1; inword=1; meta=0; double_quoted 1 ;;
      # Outside quotes a backslash makes the next character literal; a backslash-newline joins the two lines.
      '\') if getc; then [ "$c" = "$nl" ] || { W=$W$c; quoted=1; inword=1; meta=0; }
           else W=$W'\'; inword=1; meta=0; fi ;;
      '$') dollar; inword=1; meta=0 ;;
      '`') backquoted 0; meta=0 ;;
      *) W=$W$c; inword=1; meta=0 ;;
    esac
  done
  end_word; end_cmd; end_pipe
}

# '...' is literal up to the next '. An unterminated quote, here and below, runs to the end of the text.
single_quoted() {
  local c run
  while :; do
    run=${T%%\'*}; W=$W$run; T=${T:${#run}}
    getc || return 0
    [ "$c" = "'" ] && return 0
    W=$W$c
  done
}

# "...": a backslash escapes only " \ $ ` and a newline, and $( ) and ` ` still run. With $1 = 0 no quote closes it
# and the text itself is not kept (the body of a here-document, where only the substitutions matter).
double_quoted() {
  local closing=$1 c run
  while :; do
    run=${T%%[\"\\\$\`]*}; W=$W$run; T=${T:${#run}}
    getc || return 0
    case $c in
      '"') [ "$closing" = 1 ] && return 0; W=$W'"' ;;
      '\') getc || { W=$W'\'; return 0; }
           case $c in
             "$nl") ;;
             '"'|'\'|'$'|'`') W=$W$c ;;
             *) W=$W'\'$c ;;
           esac ;;
      '$') need 2
           case $T in
             '(('*) T=${T:2}; substitution 1 ;;
             '('*) T=${T:1}; substitution ;;
             *) W=$W'$' ;;
           esac ;;
      '`') backquoted 1 ;;
      "$nl") if [ "$closing" = 1 ]; then W=$W$c; else W=''; fi ;;
      *) W=$W$c ;;
    esac
  done
}

# After an unquoted $: $(( )), $( ), $'...', $"..." or ${...}; any other $ is a plain character.
dollar() {
  need 2
  case $T in
    '(('*) T=${T:2}; substitution 1 ;;
    '('*) T=${T:1}; substitution ;;
    "'"*) T=${T:1}; quoted=1; ansi_c_quoted ;;
    '"'*) T=${T:1}; quoted=1; double_quoted 1 ;;
    '{'*) T=${T:1}; W=$W'${'; parameter ;;
    *) W=$W'$' ;;
  esac
}

# $'...' decodes backslash escapes such as \' \\ and \x2d, as bash and zsh do.
ansi_c_quoted() {
  local s='' c run
  while :; do
    run=${T%%[\'\\]*}; s=$s$run; T=${T:${#run}}
    getc || break
    case $c in
      "'") break ;;
      '\') getc || break
           case $c in
             "'"|'"'|'?') s=$s$c ;;
             c) getc ;;
             *) s=$s'\'$c ;;
           esac ;;
      *) s=$s$c ;;
    esac
  done
  printf -v s '%b' "$s"
  W=$W$s
}

# ${...} is one parameter expansion, part of its word; command substitutions inside it still run.
parameter() {
  local braces=1 c run
  while :; do
    run=${T%%[\{\}\'\"\\\$\`]*}; W=$W$run; T=${T:${#run}}
    getc || return 0
    case $c in
      '{') braces=$((braces + 1)); W=$W$c ;;
      '}') W=$W$c; braces=$((braces - 1)); [ "$braces" = 0 ] && return 0 ;;
      "'") single_quoted ;;
      '"') double_quoted 1 ;;
      '\') getc && [ "$c" != "$nl" ] && W=$W$c ;;
      '$') dollar ;;
      '`') backquoted 0 ;;
      *) W=$W$c ;;
    esac
  done
}

# $( ), $(( )), <( ) and >( ): the commands inside are checked as a command line of their own, one level deeper. In
# the word around it the substitution reads as $(); SEEN collects the commands it names, so $(which git) push -f
# counts. $1 is 1 for $(( )).
substitution() {
  local seen=$SEEN
  SEEN=''
  scan_cmds ')' $((level + 1)) "${1:-0}"
  subnames=$SEEN; SEEN=$seen
  W=$W'$()'; subs=$((subs + 1)); inword=1
}

# `...` runs to the next unescaped `; a backslash before $ ` \ (and " inside double quotes) is dropped. The text is
# then checked like $( ).
backquoted() {
  local in_dq=$1 body='' seen=$SEEN c run
  while :; do
    run=${T%%[\`\\]*}; body=$body$run; T=${T:${#run}}
    getc || break
    case $c in
      '`') break ;;
      '\') getc || { body=$body'\'; break; }
           case $c in
             '$'|'`'|'\') body=$body$c ;;
             '"') if [ "$in_dq" = 1 ]; then body=$body$c; else body=$body'\'$c; fi ;;
             *) body=$body'\'$c ;;
           esac ;;
      *) body=$body$c ;;
    esac
  done
  SEEN=''
  scan_source "$body" $((level + 1))
  subnames=$SEEN; SEEN=$seen
  W=$W'$()'; subs=$((subs + 1)); inword=1
}

# A word of digits written right before < or > is a file descriptor (2>&1), not an argument.
io_number() {
  if [ "$inword" = 1 ] && [ "$quoted" = 0 ] && [[ $W =~ $digits ]]; then W=''; inword=0; fi
}

# After < or >: the operator decides what the next word is. A redirection target is not an argument, <<WORD and
# <<-WORD open a here-document, and <<< takes a here-string.
redirect() {
  if [ "$c" = '<' ]; then
    case $T in
      '<<'*) T=${T:2}; target=s ;;
      '<-'*) T=${T:2}; target=h; hstrip=1 ;;
      '<'*) T=${T:1}; target=h; hstrip=0 ;;
      '('*) T=${T:1}; meta=0; substitution ;;
      '&'*|'>'*) T=${T:1}; target=r ;;
      *) target=r ;;
    esac
  else
    case $T in
      '('*) T=${T:1}; meta=0; substitution ;;
      '>'*|'&'*|'|'*) T=${T:1}; target=r ;;
      *) target=r ;;
    esac
  fi
}

# The word in W is complete: an argument, a redirection target, a here-document delimiter or a here-string.
end_word() {
  if [ "$inword" = 1 ]; then
    case $target in
      r) ;;
      h) HD_DELIM[HD_N]=$W; HD_QUOTED[HD_N]=$quoted; HD_STRIP[HD_N]=$hstrip; HD_CMDS[HD_N]=0; HD_N=$((HD_N + 1)) ;;
      s) hs[${#hs[@]}]=$W ;;
      *) words[${#words[@]}]=$W
         if [ "$subs" = 1 ] && [ "$W" = '$()' ]; then names[${#names[@]}]=$subnames; else names[${#names[@]}]=''; fi ;;
    esac
    target=''
  fi
  W=''; inword=0; quoted=0; subs=0; subnames=''
}

end_cmd() {
  target=''
  if [ ${#words[@]} -gt 0 ]; then check_simple; piped=0; ptext[${#ptext[@]}]="${words[*]}"; words=(); names=(); fi
}

# A pipeline ends. If one of its commands is a shell or eval, its here-documents and here-strings are commands too.
end_pipe() {
  local k=0
  if [ "$pipe_shell" = 1 ]; then
    heredocs_are_commands
    while [ "$k" -lt ${#hs[@]} ]; do scan_source "${hs[k]}" $((level + 1)); k=$((k + 1)); done
  fi
  pipe_shell=0; pipe_hd=$HD_N; hs=(); ptext=()
}

heredocs_are_commands() {
  local k=$pipe_hd
  while [ "$k" -lt "$HD_N" ]; do HD_CMDS[k]=1; k=$((k + 1)); done
}

# After a newline: read the bodies of the here-documents opened on that line, in order, each up to its delimiter line.
# A body is data, skipped, unless a shell reads it (checked as commands) or its delimiter is unquoted (its command
# substitutions run). A body with no delimiter line runs to the end of the text and is checked as commands.
read_heredocs() {
  local k d line lead found text
  local -a body
  while [ "$HD_DONE" -lt "$HD_N" ]; do
    k=$HD_DONE; HD_DONE=$((k + 1)); d=${HD_DELIM[k]}; found=0; body=()
    while read_line; do
      if [ "${HD_STRIP[k]}" = 1 ]; then lead=${line%%[!$tab]*}; line=${line:${#lead}}; fi
      if [ "$line" = "$d" ]; then found=1; break; fi
      body[${#body[@]}]=$line
    done
    text=''
    [ ${#body[@]} -gt 0 ] && join_lines
    if [ "$found" = 0 ] || [ "${HD_CMDS[k]}" = 1 ]; then scan_source "$text" $((level + 1))
    elif [ "${HD_QUOTED[k]}" = 0 ]; then expand_body "$text"
    fi
  done
}

join_lines() {
  local IFS=$nl
  text="${body[*]}"
}

expand_body() {
  local S=$1 S_off=0 S_len=${#1} B='' T='' HD_N=0 HD_DONE=0 W='' inword=0 subs=0 subnames=''
  local -a HD_DELIM=() HD_QUOTED=() HD_STRIP=() HD_CMDS=()
  double_quoted 0
}

# Set i to the first word matching regex $1, or failing that to the first word that is only a command substitution
# naming $2; -1 if there is none.
find_word() {
  local k=0
  i=-1
  while [ "$k" -lt "$n" ]; do [[ ${words[k]} =~ $1 ]] && { i=$k; break; }; k=$((k + 1)); done
  if [ "$i" -lt 0 ]; then
    k=0
    while [ "$k" -lt "$n" ]; do case " ${names[k]} " in *" $2 "*) i=$k; break ;; esac; k=$((k + 1)); done
  fi
  [ "$i" -ge 0 ] && SEEN="$SEEN $2"
  return 0
}

skip_gh_options() {
  while [ "$i" -lt "$n" ]; do
    case ${words[i]} in
      -R|--repo) i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
}

# One simple command, as words after quote removal.
check_simple() {
  local n=${#words[@]} i k w cflag
  # Most commands name none of git, gh, a shell, eval or a command substitution.
  case " ${words[*]} " in *git*|*gh*|*sh*|*eval*|*'$()'*) ;; *) return 0 ;; esac
  # A push: the first git, bare or by path (but not a NAME=dir/git value), whose subcommand is push: the first word
  # after git's global options. -C, -c, --git-dir, --work-tree, --namespace, --config-env, --super-prefix and
  # --attr-source take the next word unless written with =; any other option is one word. Words after the subcommand
  # are its arguments, so a commit message that mentions git push is not a push.
  find_word "$git_word" git
  if [ "$i" -ge 0 ]; then
    i=$((i + 1))
    while [ "$i" -lt "$n" ]; do
      case ${words[i]} in
        -C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--attr-source) i=$((i + 2)) ;;
        -*) i=$((i + 1)) ;;
        *) break ;;
      esac
    done
    # Force is -f or a short-flag cluster containing f (-fu), any option that begins with --force (git accepts
    # unambiguous abbreviations such as --force-w), --mirror or an abbreviation of it (--mirr), or a +refspec.
    if [ "${words[i]:-}" = push ]; then
      k=$((i + 1))
      while [ "$k" -lt "$n" ]; do [[ ${words[k]} =~ $force_arg ]] && deny "$push_msg"; k=$((k + 1)); done
    fi
  fi
  # gh pr merge; gh api on a pull's merge endpoint.
  find_word "$gh_word" gh
  if [ "$i" -ge 0 ]; then
    i=$((i + 1)); skip_gh_options
    case ${words[i]:-} in
      pr) i=$((i + 1)); skip_gh_options; [ "${words[i]:-}" = merge ] && deny "$merge_msg" ;;
      api) k=$((i + 1))
           while [ "$k" -lt "$n" ]; do [[ ${words[k]} =~ $merge_api ]] && deny "$merge_msg"; k=$((k + 1)); done ;;
    esac
  fi
  # bash, sh, zsh or dash, by name or path: with -c, or an option cluster containing c (-lc), the first word after
  # the options is a command line. -o, -O, --rcfile and --init-file take the next word.
  i=-1; k=0
  while [ "$k" -lt "$n" ]; do [[ ${words[k]} =~ $shell_word ]] && { i=$k; break; }; k=$((k + 1)); done
  if [ "$i" -ge 0 ]; then
    pipe_shell=1; cflag=0; i=$((i + 1))
    while [ "$i" -lt "$n" ]; do
      case ${words[i]} in
        --) i=$((i + 1)); break ;;
        --rcfile|--init-file|[-+]o|[-+]O) i=$((i + 2)) ;;
        --*) i=$((i + 1)) ;;
        -*c*) cflag=1; i=$((i + 1)) ;;
        [-+]*) i=$((i + 1)) ;;
        *) break ;;
      esac
    done
    [ "$cflag" = 1 ] && [ "$i" -lt "$n" ] && scan_source "${words[i]}" $((level + 1))
    # The words of the commands that pipe into a shell are a command line too: echo 'git push -f' | bash.
    k=0
    while [ "$k" -lt ${#ptext[@]} ]; do scan_source "${ptext[k]}" $((level + 1)); k=$((k + 1)); done
  fi
  # eval: its words joined with spaces are a command line.
  k=0
  while [ "$k" -lt "$n" ]; do
    if [ "${words[k]}" = eval ]; then
      pipe_shell=1; w=''
      k=$((k + 1))
      while [ "$k" -lt "$n" ]; do w="$w ${words[k]}"; k=$((k + 1)); done
      scan_source "${w# }" $((level + 1))
    fi
    k=$((k + 1))
  done
  return 0
}

SEEN=''
scan_source "$cmd" 0
exit 0
