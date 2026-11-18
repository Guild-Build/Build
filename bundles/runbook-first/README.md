# Runbook First

A build with one hook and nothing else. When a Claude Code session starts in a repository, the hook looks for the
repository's own operating documents and, if it finds any, adds a few lines to the agent's context before the first
prompt: which documents exist, to read the ones that govern the requested change before changing anything, to run the
checks they name, and to say in the reply which it read.

## What it looks for

First these names, at the repository's top folder (found with `git rev-parse --show-toplevel`, or the session's folder
when it is not a git repository):

- agent instructions: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`
- a runbook: `RUNBOOK.md`, `runbook.md`, `docs/RUNBOOK.md`, `docs/runbook.md`
- a contributing guide: `CONTRIBUTING.md`, `docs/CONTRIBUTING.md`, `.github/CONTRIBUTING.md`
- the README (`README.md`, `README`, `readme.md`, `Readme.md` or `README.markdown`), only when, among the first 20
  `.md` names in its first 64 KB whose file name starts with `runbook`, `contributing`, `agents`, `claude` or
  `copilot-instructions`, one names a document above, by its path or file name, or another existing file; such a file
  is listed too.

Then what else the README names in its first 64 KB, in the order it names them:

- a file whose name ends, in any case, in `.md`, `.markdown`, `.rst`, `.txt` or `.adoc`, listed as
  `<path> (named in the README)`. Only the first 20 distinct such names count. A license, licence, copying, notice,
  code of conduct, security or authors file (by its name without the ending) is left out, and so is the README itself.
- a folder, written as a path that ends in `/` with no name character after it, listed once as
  `<path>/ (folder of documents, named in the README)` when it holds at most 200 entries and every entry directly in
  it, hidden ones included, is a folder (not looked into) or a regular file with one of those endings, at least one of
  them such a file. Only the first 20 distinct folder names count. The files in it are not opened: `find` lists its
  entries with their exact names, and only the first 201 are looked at, each by its own name and type.

A name is read from the top folder; a leading `./` is dropped, and an absolute name, one holding `..`, or one inside a
web address is refused. A name counts only when it is a regular file the session can read (or, for a folder, a folder),
is not a symbolic link, and has no symbolic link among the folders on its path below the top folder; a link is skipped
even when it points inside the repository. The documents found by conventional name come first, then the files and
folders the README names, then the README's own entry. At most eight documents are listed, besides the README, in that
order, so a name the README holds never takes the place of a document found by convention; any more that are found are
counted in the list's ending, "and N more".

## When it stays silent

When none of those documents exists, it adds nothing. It exits 0 in every case, so it never stops a session: a folder
it cannot open leaves it silent, and a file it cannot read is left out. Its hook entry gives it a five-second timeout.

## What it costs

No tool call and no model call. It runs `git rev-parse` to find the top folder, checks the names above, reads the start
of the README (twice: once for each kind of name), lists the first entries of a folder the README names with `find`
and looks at them by name and type only, writes nothing and uses no network.
The text it adds is 200 characters plus the list of names, when a session starts with a source its matcher names
(`startup|clear|compact`). It never exceeds 1,200 characters: when the whole list would be longer, the list keeps
documents in order, each name whole, while they fit beside an ending that says how many more there are. The room for
that ending is first set for a one-digit count and, if the count reaches 10, set again for two digits, so near the
limit a name can be left out although it would fit beside a count one digit shorter. The documents found by
conventional name and the README's own entry are kept just as they would be without the other names the README holds;
those take only the room left, by the same rule, and the ending counts the ones left out. When even that count would
not fit beside what is kept, the other names the README holds are neither listed nor counted. For example, 264
characters:

```
Operating documents in this repository: docs/RUNBOOK.md (runbook), README.md (points to docs/RUNBOOK.md).
Before you change anything, read the ones that govern the requested change.
Run the checks they name, and say in your reply which of these documents you read.
```

## Module

- `operating-docs-notice` (SessionStart hook): `scripts/operating-docs-notice.sh`, Bash 3.2 or later with `head`,
  `grep`, `tr` and `find`, and git when it is installed; it returns the text as `additionalContext`.

Licensed under the Apache License 2.0.
