# Changing the catalog

You change the catalog by pushing commits to `main`. Every push that passes
Shinan's checks changes the catalog at once; nobody approves it first, and
everyone's agents rely on it straight away. So check your work as carefully
as a reviewer would.

If your token is read-only, or Shinan is unavailable, record the update you
owe (what, why and the evidence) on your task or in your report, and tell
your person.

## Quick path

The usual change, start to finish. Read on when a step fails.

```sh
export GIT_TERMINAL_PROMPT=0
cd "$(git config --global --get shinan.catalog)" && git fetch origin   # 1. fetch
git worktree add -b disk-resize ../disk-resize origin/main && cd ../disk-resize  # 2. worktree
# 3. edit the documents; fact checks name you, with the real check time (facts.md)
git add -A && git commit -m "Record the data disk after the resize (SHN-12)"  # 4. commit
git fetch origin && git rebase origin/main          # 5. bring in what others pushed
git push origin HEAD:main                           # 6. push
# 7. read every remote: line; if refused, fix in a new commit and push again
cd - && git worktree remove ../disk-resize && git branch -D disk-resize  # 8. clean up
```

## When to change it

- **Your work changed or checked a durable fact the catalog records:**
  push the update before you report the work as done, or record exactly what
  update is pending and why. Examples: you deployed a new version, moved a
  checkout, added a dependency, or looked at a fact and found it still true.
- **Narrow scope:** only the documents and facts your task touched. Do not
  refresh unrelated facts, rewrite bodies or reorganise documents on the way.
  One commit per coherent change.
- **Evidence:** every new or changed fact comes with its fact check
  ([facts.md](facts.md)). The commit message says why, in a few sentences.
- **Never extra access:** the obligation never permits logging in somewhere,
  scanning machines or reading secrets to gather facts. If you cannot check
  a fact with the access your task already has, leave it, or write it as
  `unknown` with a note.
- **Not in the catalog:** task status and progress (tasks hold those),
  activity, secrets.

## The workflow

The machine's clone stays on `main` and is never edited: each task works in
its own worktree beside it, on a new local branch from `origin/main`.

```sh
export GIT_TERMINAL_PROMPT=0
cd "$(git config --global --get shinan.catalog)"
git fetch origin
git worktree add -b disk-resize ../disk-resize origin/main
cd ../disk-resize
```

1. **Edit** the documents with your editor's tools. Keep the existing style
   of each document; write facts as [facts.md](facts.md) says.
2. **Commit** with a message saying why, and the task if there is one:
   `git add -A && git commit -m "Record the data disk after the resize (SHN-12)"`.
   The commit's author name and email do not matter to Shinan.
3. **Bring in what others pushed:** `git fetch origin && git rebase origin/main`
   (or `git merge origin/main`). If a document conflicts, resolve it from
   the evidence and the check times, never by taking one side because it
   came last: two values with valid fact checks may both stay, as a
   discrepancy. Keep every other fact check exactly as it was. If your
   branch holds another agent's commits (you merged its branch), merge
   `origin/main` instead of rebasing.
4. **Check without changing anything,** when you are unsure:
   `git push -o check-only origin HEAD:main` runs every check for `main`
   and prints the result, starting "Shinan checked this push (check only)",
   and never changes anything. `-o check-only` is the only push option
   Shinan knows.
5. **Push:** `git push origin HEAD:main`. Read every `remote:` line of the
   output, including warnings, even when the push is accepted.
6. **If it is refused,** nothing was changed. Fix each problem in a new
   commit and push again, except problems inside your commits (a secret, a
   file Shinan can't take): those need the commits rewritten, as the output
   and the table below say. If it is refused because `main` moved
   (`rejected … (fetch first)` or `non-fast-forward`), go back to step 3.
7. **Clean up:** `cd` back to the clone,
   `git worktree remove ../disk-resize` and `git branch -D disk-resize`.

**Branches.** Push a branch (`git push origin HEAD:refs/heads/<name>`) only
to share unfinished work; Shinan checks it for secrets, but it is not the
catalog, it is never shown, and nobody should rely on it. Delete it once it
is merged or abandoned (`git push origin --delete <name>`). A repository
holds at most 100 branches.

**Other agents' work.** Shinan records which agent first pushed each
commit, on any branch, and a fact check must name the agent that first
pushed the commit introducing it.

- **Merging** another agent's branch that it has pushed is fine
  (`git merge origin/<branch>`, then push `main`): its commits keep their
  first pusher, so its fact checks still name the right agent.
- **Never rebase, cherry-pick or squash** another agent's commits that add
  fact checks: that makes new commits, first pushed by you, whose fact
  checks name someone else, and the push is refused. Rebase and squash only
  your own work.
- **Never write another agent's name** in a fact check, including while
  resolving a merge conflict. If a conflict leaves a fact check that is
  neither side's exactly, write it under your own fact check only if you
  checked the facts, or keep one side as it was.
- An agent's branch that was never pushed isn't yours to land: ask it to
  push, or check the facts yourself and record your own fact checks.

**Never force `main`.** Shinan refuses a push that deletes or rewrites it.

## Retire, never delete

An ID that `main` has must keep resolving. Deleting a document, or renaming
it without keeping its old ID, is refused.

- **Retire** a document: `status: retired` and `replaced_by: <ID>` naming
  its replacement, if there is one. Its file stays.
- **Change an ID:** `git mv machine/old.md machine/new.md`, set `id:
machine/new`, and add `machine/old` to `aliases`. A document's path is
  always its ID plus `.md`. Update the references in other documents in the
  same commit when your task allows; the alias keeps the rest working.

## Undo

Undo a commit on `main` with `git revert <commit>`, then push it like any
change; the commit message says why. It goes through the same checks. A
revert that restores another agent's fact check exactly as it was on `main`
passes: it keeps naming the agent that first pushed it. Never rewrite
`main`'s history.

**After a purge,** a workspace owner has rewritten the history to remove
leaked text, and your next fetch shows `main` forced. Reset your clone onto
it (`git checkout main && git reset --hard origin/main` in the clone, which
you never edit), redo any unpushed work on new branches from `origin/main`,
and delete old branches. Never push old history back: Shinan refuses
commits removed by a purge.

## An example

A recheck found the data disk of `machine/build-1` larger than recorded.
Before:

```markdown
---
id: machine/build-1
type: machine
title: Build 1
summary: Builds release images.
status: active
owner: person/alex
facts:
  - checked: 2026-10-02T14:05:31Z
    by: alex via opencode-build-1
    scope: Size of the data disk
    source: df -h /data on build-1
    observed:
      disk.data.size: 64 GiB
---

# Build 1

Builds release images for every project.
```

After, in one commit with the message "Record the data disk after the
resize; checked with df (SHN-12)":

```markdown
---
id: machine/build-1
type: machine
title: Build 1
summary: Builds release images.
status: active
owner: person/alex
facts:
  - checked: 2026-11-18T09:42:17Z
    by: alex via opencode-build-1
    scope: Size of the data disk after the resize
    source: df -h /data on build-1
    observed:
      disk.data.size: 128 GiB
---

# Build 1

Builds release images for every project. The data disk was grown to 128 GiB
on 2026-11-18 (SHN-12).
```

The old group held only that fact, so it is gone; had it held others, they
would stay in it, unchanged.

## Why a push is refused

Shinan prints the verdict, every blocking problem and warning with its
place, a code and a message, and what to do next:

```text
remote: Shinan refused this push. Nothing was changed.
remote: 2 blocking problems:
remote:   machine/build-1.md:9   by-not-first-pusher   "by: alex" but commit 1a2b3c4 was first pushed by "alex via opencode-build-1"
remote:   machine/build-1.md:14  reference-unresolved  "service/ingres" is not a catalog ID or alias
remote: 1 warning (does not block):
remote:   machine/build-1.md:12  key-not-in-schema     "disk.cache.size" is not a key of type machine
remote: Fix them in new commits and push again. The shinan skill explains each code.
```

A suspected secret's value is never shown, only its kind, its place and a
fingerprint (`sha256:…`). When a problem is inside the commits you push (a
secret, a symbolic link, a file too large), the last line says instead:
"These problems are in commits not yet in Shinan: rewrite them (git rebase
-i origin/main), then push again. A new commit on top won't help." Those
are your own unpushed commits, so rewriting them is fine; rewrite only your
own.

**`by-not-first-pusher`**, the refusal you are most likely to meet: name
yourself only on fact checks you made. For another agent's, merge its
pushed branch; don't rebase, cherry-pick or squash it.

**Blocking**, the most likely first. "Any branch" codes are checked on
every push; the rest only when `main` changes. Unless the row says
otherwise, fix the problem in a new commit.

| Code                     | Means                                                                                          | What to do                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `by-not-first-pusher`    | A new or changed fact check doesn't name the agent that first pushed the commit introducing it | Name yourself only on fact checks you made. For another agent's, merge its pushed branch; don't rebase, cherry-pick or squash it                       |
| `secret`                 | Any branch: a file, commit message or branch name holds a near-certain credential              | Rewrite your commits without it (`git rebase -i origin/main`) and tell your person; if it is not a secret, a workspace owner can allow its fingerprint |
| `reference-unresolved`   | A reference does not resolve to an ID or alias                                                 | Fix the reference, or create the document                                                                                                              |
| `frontmatter-invalid`    | The frontmatter is missing, is not YAML, or uses YAML Shinan does not read                     | Fix the YAML: plain maps, lists and scalars only                                                                                                       |
| `fact-check-incomplete`  | A fact check lacks `checked`, `by`, `scope` or `source`                                        | Add the missing field                                                                                                                                  |
| `fact-check-missing`     | An `intended` or `observed` fact has no fact check                                             | Put it in a fact check group                                                                                                                           |
| `date-invalid`           | A date or time is not written as Shinan reads them                                             | `2026-11-18`, or `2026-11-18T09:42:17Z` with an offset                                                                                                 |
| `checked-in-future`      | `checked` is in the future                                                                     | Write the real time of the check                                                                                                                       |
| `identity-duplicate`     | Two current facts are the same fact                                                            | Keep one, or give a second observation its own `via`                                                                                                   |
| `cardinality`            | A single-valued key holds a list                                                               | One value, or two facts with different `via`                                                                                                           |
| `fact-invalid`           | A fact's value or long form does not fit its key                                               | Fix the fact as [facts.md](facts.md) shows                                                                                                             |
| `facts-invalid`          | `facts` or one of its groups is not shaped as [facts.md](facts.md) shows                       | Fix the group                                                                                                                                          |
| `fact-check-invalid`     | A fact check's `by` is not a written actor                                                     | `<person handle> via <agent handle>`                                                                                                                   |
| `path-id-mismatch`       | A document's path is not its `id` plus `.md`                                                   | Move the file or fix the `id`                                                                                                                          |
| `id-disappeared`         | An ID or alias that resolved before no longer does                                             | Retire the document, or keep the old ID in `aliases`                                                                                                   |
| `path-not-allowed`       | A file or folder outside the layout (lower-case paths, plain files, not executable)            | Remove it, or move it to `<type>/<slug>.md`                                                                                                            |
| `field-missing`          | A required document field is missing                                                           | Add it                                                                                                                                                 |
| `field-invalid`          | A document field has the wrong form, or does not belong                                        | Fix or remove it                                                                                                                                       |
| `type-unknown`           | `type` names no built-in type and no active type schema                                        | Use a type in [types.md](types.md), or add `schema/<type>.md`                                                                                          |
| `reference-type`         | A relation points to a type it may not                                                         | Point it at the right type ([types.md](types.md))                                                                                                      |
| `planned-without-task`   | A `planned` fact names no task or accepted decision                                            | Add `task`                                                                                                                                             |
| `id-duplicate`           | Two documents share an ID or alias                                                             | Remove the duplicate                                                                                                                                   |
| `unchecked-not-imported` | `checked: null` or `by: unknown` outside an imported document                                  | Write a real fact check, or move the fact to an `unknown` list                                                                                         |
| `busy`                   | Any branch: another push to this repository is being checked                                   | Push again in 30 seconds                                                                                                                               |
| `main-not-fast-forward`  | Any branch: the push would delete `main` or move it backwards                                  | Fetch, then merge, or rebase your own commits, onto `origin/main`; push again                                                                          |
| `check-only`             | Any branch: a check-only push; nothing was changed                                             | Nothing; push without `-o check-only` when ready                                                                                                       |
| `push-option-unknown`    | Any branch: a push option other than `-o check-only`                                           | Remove it                                                                                                                                              |
| `check-failed`           | Any branch: Shinan could not check the push                                                    | Try again; tell your person if it happens again                                                                                                        |
| `schema-invalid`         | A type schema document is malformed                                                            | Fix it                                                                                                                                                 |
| `schema-breaks-entities` | A type schema change would break current documents of that type                                | Change those documents first, or keep the key                                                                                                          |
| `start-here-invalid`     | The start-here document is malformed                                                           | Fix it                                                                                                                                                 |
| `too-large`              | A document is longer than 64 KiB                                                               | Split it                                                                                                                                               |
| `body-invalid`           | The body is past what Shinan reads (very deep nesting, too many links)                         | Simplify the Markdown                                                                                                                                  |
| `ref-name-invalid`       | Any branch: a branch name is at most 100 letters, digits, `.`, `_`, `/` and `-`                | Push under another name                                                                                                                                |
| `ref-not-branch`         | Any branch: only branches can be pushed, not tags or other refs                                | Push a branch                                                                                                                                          |
| `too-many-branches`      | Any branch: the repository would have more than 100 branches                                   | Delete merged ones (`git push origin --delete <branch>`)                                                                                               |
| `purged-commit`          | Any branch: a commit was removed by a purge                                                    | Fetch, then reset your branch onto the new history (see "After a purge")                                                                               |
| `symlink`                | Any branch: a commit holds a symbolic link                                                     | Rewrite your commits with a file instead                                                                                                               |
| `submodule`              | Any branch: a commit holds a submodule                                                         | Rewrite your commits without it                                                                                                                        |
| `file-too-large`         | Any branch: a new file is larger than 1 MiB                                                    | Rewrite your commits without it: leave it out of the catalog                                                                                           |
| `commit-too-large`       | Any branch: a commit, with its message, is larger than 64 KiB                                  | Rewrite the commit with a shorter message                                                                                                              |
| `path-not-portable`      | Any branch: a name Windows or macOS cannot check out, or two names they see as one             | Rewrite your commits, renaming it                                                                                                                      |
| `tree-too-large`         | Any branch: a folder or commit holds far more files than any catalog needs                     | Rewrite your commits without them                                                                                                                      |
| `too-many-commits`       | Any branch: the push brings more than 1,000 new commits                                        | Push in parts                                                                                                                                          |
| `main-too-many-commits`  | The push adds more than 2,000 commits to `main`                                                | Merge in parts                                                                                                                                         |
| `too-slow`               | Any branch: checking took longer than Shinan allows                                            | Push smaller changes                                                                                                                                   |
| `catalog-too-large`      | The catalog would pass 20,000 documents or 50 MiB of text, or is too large to check            | Tell your person                                                                                                                                       |
| `repository-full`        | Any branch: the repository is over its 1 GiB limit; only branch deletions are accepted         | Tell your person                                                                                                                                       |
| `read-failed`            | Shinan could not read a document: a bug in Shinan                                              | Tell your person, with the file                                                                                                                        |

**Warnings** do not block the push, but read them: they are often a typo.

| Code                     | Means                                                                  | What to do                                                                           |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `key-not-in-schema`      | A key the type schema does not name                                    | Check its spelling in [types.md](types.md) or `schema/<type>.md`; fix it if it's off |
| `secret-suspected`       | Any branch: text looks like a secret                                   | If it is one, rewrite your commits without it at once and tell your person           |
| `check-older`            | A new fact check is older than the one it replaces                     | Keep the newer check unless your evidence is better; say why in the commit           |
| `task-status`            | A task status (`in progress`, …) written as a fact                     | Remove it: tasks hold their status                                                   |
| `start-here-retired`     | A start-here step points to a retired document                         | Point it at the replacement, if your task covers start-here                          |
| `start-here-discrepancy` | A start-here step points to a document with a discrepancy not accepted | Tell your person; resolve the discrepancy only from evidence                         |
| `owner-not-member`       | An owner's `person` document is not linked to a current member         | Tell your person; don't change owners on your own                                    |

**Errors from Git itself:** `401` or `Authentication failed` means your token
is missing or revoked, `403` that it is read-only or this workspace is not
yours, `429` too many requests (wait a minute). Tell your person about the
first two; never look for the token.
