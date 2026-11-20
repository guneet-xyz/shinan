# Product principles

Status: **living document.** The role and its aim are **decided** by the
owner on 2026-11-20 ([D-067](decisions/D-067-product-owner-role.md)): put the
experience of people using Shinan first, with "simple easy to understand and
use features and human facing web design" rather than "complex and
information dense designs and flows". The principles below restate that aim
and the owner's catalog decision of 2026-11-19 ("simple and easy on the
eyes", navigation on the left, not by types:
[D-064](decisions/D-064-catalog-not-wiki.md)). The wording lists and
examples are **proposed** and change through ordinary pull requests.

This document is kept by the product owner agent. How it reviews work is in
the [build plan §4](build-plan.md#4-how-the-work-is-done-proposed). The
detailed screen designs are in [human experience](human-experience.md);
this document is the yardstick they are reviewed against, not a second
design.

## Principles

1. **Few concepts.** People should get value without learning Shinan's
   internal model: entity types, fact identity, fact states, scopes, push
   logs, workspace IDs. Show what people recognise: pages, folders,
   projects, machines, changes, who did what and when.
2. **Plain words.** Everyday words, short sentences, no internal names on
   screens. Say what something is for, not how it works. An error says what
   happened and what to do next.
3. **One job per screen.** Each screen answers one question or does one job.
   Its main action is obvious; the rest is one step away, not all shown at
   once.
4. **Less is more.** Prefer removing a feature, field, setting, column or
   option to adding one. Defaults over settings. If a flow needs
   instructions to be understood, simplify the flow before writing the
   instructions.
5. **Calm, readable design.** Generous spacing, readable type and line
   length, a clear hierarchy, one left-side navigation used everywhere, few
   colours and each with a meaning. Prose or a short list instead of walls
   of badges and tables. Works on a phone, light and dark. Accessibility
   (WCAG 2.2 AA) and the strict Content Security Policy are checked by the
   code reviewer; the product review judges the experience.
6. **Good empty, loading and error states.** Someone with nothing yet knows
   what to do next.
7. **Agents are users too,** through Git and the skill rather than screens.
   Keep their setup short and their messages precise and actionable.

## Words on screens

These are the words people see in the web app and emails. Documents keep
the [glossary](domain-model.md)'s terms; a screen may use a plainer word for
the same thing.

| Say                                      | Instead of                                                       |
| ---------------------------------------- | ---------------------------------------------------------------- |
| page                                     | entity, document, entity document                                |
| folder (`machine/`, `service/`)          | type, entity type (except on a type's own `schema/` page)        |
| Recent changes; a change                 | commit history, revision, push (the owner's GQ-6 names the list) |
| Guneet, through OpenCode on Daedalus     | `guneet via opencode-daedalus`, pusher, actor                    |
| checked 3 days ago; not checked yet      | `checked: 2026-11-17T…`, observed, fact check                    |
| should be 128 GiB; seen 128 GiB; unknown | `intended`, `observed`, fact state badges                        |
| These disagree                           | discrepancy                                                      |
| Needs attention (one list)               | due for recheck, known unknowns, discrepancies (as three lists)  |
| Copy the address to clone it             | clone URL, smart HTTP, repository ID                             |
| Allow this value (it is not a secret)    | fingerprint, SHA-256, allowlist                                  |
| Remove text from the catalog's history   | purge, history rewrite                                           |

Machine words (IDs, file names, commands) are fine where the person must
copy or type them, shown once and in a code style, never as labels.

## Do and don't, from today's screens

Drawn from v0.3.0 and M2's screenshots (M2-7, M2-8, M1-8).

- **Page header.** Don't open a page with a row of labels: "Type machine ·
  ID `machine/musashi` · Status active · Owner `person/guneet` · Former IDs
  `machine/takezo-old`". Do show the title and its one-line summary, then
  the content; keep the ID, old IDs and owner in a quiet "About this page"
  line at the bottom.
- **Facts.** Don't show raw keys (`disk.data.size`) in monospace with a
  "seen" badge, "How it was checked" and an action under every value. Do
  write a readable list, "Data disk size: 128 GiB, checked 5 days ago", with
  the check's details one step away.
- **Navigation.** Don't stack two rows of tabs ("Wiki | Settings", then
  "Wiki home · Start here · Recent changes · Search · Review"). Do use one
  navigation on the left, holding the catalog's folders and pages, search
  at its top and the few other places below.
- **Recent changes.** Don't write "Revision 2 · Nov 19, 1:56 AM · guneet via
  opencode-daedalus · catalog proposal 1" above a block of fifteen IDs. Do
  write one sentence per change: what it says (its message), who and when
  ("Guneet, through OpenCode on Daedalus, 2 hours ago"), and the first few pages it
  changed by title, with "and 12 more" behind a click.
- **Start here.** Don't add machinery around the page ("Agents read this
  whole path when they start. Its size: 891 bytes."). Do show the page as
  its writer wrote it.
- **Your agents.** Don't give every agent six label rows and four buttons,
  two of them red, side by side. Do give one line per agent ("OpenCode on
  Daedalus, last used 2 hours ago") and put rename, replace and revoke in
  one menu.
- **Setup.** Don't explain mechanisms on the page (credential helpers,
  `GIT_TERMINAL_PROMPT`, headers, MCP). Do give numbered steps, each one
  sentence and one block to copy, with the why behind a "Why?" link.

## History

- 2026-11-20: first version, with the product owner role
  ([D-067](decisions/D-067-product-owner-role.md),
  [#183](https://github.com/guneet-xyz/shinan/issues/183)).
