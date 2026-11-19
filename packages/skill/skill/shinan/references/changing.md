# Changing the catalog

You change the catalog by pushing commits to `main`. Every push that passes
Shinan's checks changes the catalog at once; nobody approves it first, and
everyone's agents rely on it straight away. So check your work as carefully
as a reviewer would.

If your token is read-only, or Shinan is unavailable, record the update you
owe (what, why and the evidence) on your task or in your report, and tell
your person.

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
   discrepancy. Keep every other fact check exactly as it was.
4. **Check without changing anything,** when you are unsure:
   `git push -o check-only origin HEAD:main` runs every check for `main`,
   prints the result and always refuses, with "check only: nothing was
   changed". _(Wording to be confirmed with Shinan's push checks, GC-3.)_
5. **Push:** `git push origin HEAD:main`. Read every `remote:` line of the
   output, including warnings, even when the push is accepted.
6. **If it is refused,** nothing was changed. Fix each problem in a new
   commit and push again. If it is refused because `main` moved
   (`rejected … (fetch first)` or `non-fast-forward`), go back to step 3.
7. **Clean up:** `cd` back to the clone,
   `git worktree remove ../disk-resize` and `git branch -D disk-resize`.

**Branches.** Push a branch (`git push origin HEAD:refs/heads/<name>`) only
to share unfinished work; Shinan checks it for secrets, but it is not the
catalog, it is never shown, and nobody should rely on it. Delete it once it
is merged or abandoned (`git push origin --delete <name>`). A repository
holds at most 100 branches.

**Never merge another agent's branch that adds fact checks** into `main`.
Its fact checks name that agent, and a push must name its pusher in every
new or changed fact check, so Shinan refuses it. Ask that agent to push its
own work, or check the facts yourself and record your own fact checks. A
branch without fact checks (body text, a new document's description) can be
merged.

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
revert that brings back an earlier fact check of someone else's counts as a
fact check naming someone else, so it is refused: write those facts again
under your own fact check if you checked them, or as `unknown`. Never
rewrite `main`'s history.

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

Shinan prints every problem, one per line, after `remote:`, with the file,
the line, a code and a message, then warnings, which do not block:

```text
remote: Shinan refused this push. Nothing was changed.
remote: main: 2 blocking problems
remote:   machine/build-1.md:9   by-not-pusher         "by: alex" but this push is by "alex via opencode-build-1"
remote:   machine/build-1.md:14  reference-unresolved  "service/ingres" is not a catalog ID or alias
remote: main: 1 warning (does not block)
remote:   machine/build-1.md:12  key-not-in-schema     "disk.cache.size" is not a key of type machine
remote: Fix them in new commits and push again. The shinan skill explains each code.
```

_The codes for pushes, refs and files below are to be confirmed against
Shinan's push checks (GC-3); the document codes are Shinan's validation
codes._ A suspected secret's value is never shown, only its kind, its
place and a fingerprint (`sha256:…`).

**Every push, to any branch:**

| Code                    | Means                                                                    | What to do                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `secret`                | A file, commit message or branch name holds a near-certain credential    | Rebuild your commits without it (`git reset --soft origin/main`, remove it, commit again); tell your person |
| `ref-not-branch`        | Only branches (`refs/heads/…`) can be pushed: no tags or other refs      | Push a branch                                                                                               |
| `ref-name-invalid`      | Branch names: at most 100 letters, digits, `.`, `_`, `/` and `-`         | Use another name                                                                                            |
| `main-not-fast-forward` | The push would rewrite or delete `main`                                  | Fetch, rebase or merge onto `origin/main`, push again                                                       |
| `too-many-branches`     | The repository already has 100 branches                                  | Delete merged branches                                                                                      |
| `purged-commit`         | A commit was removed by a purge                                          | Reset onto the new history (see "After a purge")                                                            |
| `symlink`               | A commit holds a symbolic link                                           | Replace it with a file                                                                                      |
| `submodule`             | A commit holds a submodule                                               | Remove it                                                                                                   |
| `file-too-large`        | A new file is larger than 1 MiB                                          | Shrink it; documents on `main` have 64 KiB                                                                  |
| `too-many-commits`      | The push brings more than 1,000 new commits                              | Push in parts                                                                                               |
| `repository-full`       | The repository is over its size limit; only branch deletions are allowed | Tell your person                                                                                            |
| `busy`                  | Another push to `main` is being checked                                  | Push again in a minute                                                                                      |
| `too-slow`              | Checking took longer than Shinan allows                                  | Push smaller changes                                                                                        |
| `check-only`            | A check-only push: nothing was changed                                   | Nothing; push without `-o check-only` when ready                                                            |

**Pushes to `main`,** on the whole new catalog:

| Code                     | Means                                                                      | What to do                                                          |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `path-not-allowed`       | A file or folder outside the layout, or an executable file                 | Remove it, or move it to `<type>/<slug>.md`                         |
| `path-id-mismatch`       | A document's path is not its `id` plus `.md`                               | Move the file or fix the `id`                                       |
| `id-disappeared`         | An ID or alias that resolved before no longer does                         | Restore the document and retire it, or keep the old ID in `aliases` |
| `by-not-pusher`          | A new or changed fact check's `by` is not this push's agent and person     | Write your own `by`; leave other fact checks as they were           |
| `catalog-too-large`      | The catalog would pass 20,000 documents or 50 MiB of text                  | Tell your person                                                    |
| `too-large`              | A document is longer than 64 KiB                                           | Split it                                                            |
| `frontmatter-invalid`    | The frontmatter is missing, is not YAML, or uses YAML Shinan does not read | Fix the YAML: plain maps, lists and scalars only                    |
| `body-invalid`           | The body is past what Shinan reads (very deep nesting, too many links)     | Simplify the Markdown                                               |
| `field-missing`          | A required document field is missing                                       | Add it                                                              |
| `field-invalid`          | A document field has the wrong form, or does not belong                    | Fix or remove it                                                    |
| `date-invalid`           | A date or time is not written as Shinan reads them                         | `2026-11-18`, or `2026-11-18T09:42:17Z` with an offset              |
| `facts-invalid`          | `facts` or one of its groups is not shaped as [facts.md](facts.md) shows   | Fix the group                                                       |
| `fact-invalid`           | A fact's value or long form does not fit its key                           | Fix the fact                                                        |
| `cardinality`            | A single-valued key holds a list                                           | One value, or two facts with different `via`                        |
| `schema-invalid`         | A type schema document is malformed                                        | Fix it                                                              |
| `start-here-invalid`     | The start-here document is malformed                                       | Fix it                                                              |
| `type-unknown`           | `type` names no built-in type and no active type schema                    | Use a type in [types.md](types.md), or add `schema/<type>.md`       |
| `id-duplicate`           | Two documents share an ID or alias                                         | Remove the duplicate                                                |
| `reference-unresolved`   | A reference does not resolve to an ID or alias                             | Fix the reference, or create the document                           |
| `reference-type`         | A relation points to a type it may not                                     | Point it at the right type ([types.md](types.md))                   |
| `fact-check-missing`     | An `intended` or `observed` fact has no fact check                         | Put it in a fact check group                                        |
| `fact-check-incomplete`  | A fact check lacks `checked`, `by`, `scope` or `source`                    | Add the missing field                                               |
| `fact-check-invalid`     | A fact check's `by` is not a written actor                                 | `<person handle> via <agent handle>`                                |
| `checked-in-future`      | `checked` is in the future                                                 | Write the real time of the check                                    |
| `unchecked-not-imported` | `checked: null` or `by: unknown` outside an imported document              | Write a real fact check, or move the fact to an `unknown` list      |
| `planned-without-task`   | A `planned` fact names no task or accepted decision                        | Add `task`                                                          |
| `identity-duplicate`     | Two current facts are the same fact                                        | Keep one, or give a second observation its own `via`                |
| `schema-breaks-entities` | A type schema change would break current documents of that type            | Change those documents first, or keep the key                       |
| `read-failed`            | Shinan could not read a document: a bug in Shinan                          | Tell your person, with the file                                     |

**Warnings** do not block the push; fix them if they are yours:

| Code                     | Means                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| `secret-suspected`       | Text looks like a secret. If it is one, remove it and tell your person at once  |
| `key-not-in-schema`      | A key the type schema does not name: check its spelling in [types.md](types.md) |
| `check-older`            | A new fact check is older than the one it replaces                              |
| `task-status`            | A task status (`in progress`, …) written as a fact; tasks hold those            |
| `start-here-retired`     | A start-here step points to a retired document                                  |
| `start-here-discrepancy` | A start-here step points to a document with a discrepancy not accepted          |
| `owner-not-member`       | An owner's `person` document is not linked to a current member                  |

**Errors from Git itself:** `401` or `Authentication failed` means your token
is missing or revoked, `403` that it is read-only or this workspace is not
yours, `429` too many requests (wait a minute). Tell your person about the
first two; never look for the token.
