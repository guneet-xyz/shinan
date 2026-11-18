# Changing the catalog

The write tools need a full token. If your token is read-only, or Shinan is
unavailable, record the update you owe (what, why and the evidence) on your
task or in your report, and tell your person.

## When to propose

- **Your work changed or checked a durable fact the catalog records:**
  propose the update before you report the work as done, or record exactly
  what update is pending and why. Examples: you deployed a new version, moved
  a checkout, added a dependency, or looked at a fact and found it still
  true.
- **Narrow scope:** only the entities and facts your task touched. Do not
  refresh unrelated facts, rewrite bodies or reorganise entities on the way.
  One proposal per coherent change.
- **Evidence:** every new or changed fact comes with its fact check
  ([facts.md](facts.md)). The explanation says why, in a few sentences.
- **Never extra access:** the obligation never permits logging in somewhere,
  scanning machines or reading secrets to gather facts. If you cannot check
  a fact with the access your task already has, leave it, or write it as
  `unknown` with a note.
- **Not in the catalog:** task status and progress (tasks hold those),
  activity, secrets.

## How a proposal applies

Every change is a catalog proposal: an explanation, a list of operations
and, where there is one, the related task. It applies all or nothing, as a
new catalog revision.

- **Applies at once:** rechecks; adding, changing or removing `observed`,
  `unknown`, `intended` or `planned` facts; body text, titles and summaries;
  new entities.
- **Waits for a person's catalog approval** (gated): policies; a decision
  becoming `accepted`, `rejected` or `superseded`; type schemas; the
  start-here document; deprecating, retiring, changing an ID or an owner;
  any change to `person` or `agent` entities; and doubtful changes: a fact
  check older than the current one, accepting a discrepancy, or text
  validation warns about (such as something that looks like a secret).
- A workspace may switch on a strict setting, under which more changes wait.
- Only people approve proposals; agents never do.

## The tools

- `propose_catalog_change`:
  - `explanation`: why, in a few sentences (at most 4,000 characters);
  - `operations`: at most 50, naming at most 100 facts in all, 256 KiB in
    all; split a larger change into several proposals;
  - `related_task` (optional): the task ID, such as `SHN-12`;
  - `idempotency_key`: a key you choose for this change, such as
    `SHN-12-disk-resize`. If the call fails on the way, send the same
    proposal with the same key: it is stored once, and you get it back.
- `record_fact_check`: a recheck, when you checked facts of one entity at
  their source and their values did not change: `document`, `facts` (each
  as it is now, see expectations below), `check` (`checked`, `scope`,
  `source`, `limits`), an optional `explanation` and `related_task`, and an
  `idempotency_key`. It is a proposal with one `recheck-facts` operation. A
  value that changed is a `set-fact` in `propose_catalog_change` instead.
- `get_catalog_proposal`: a proposal by `id`, with its state, operations,
  approval classes, the reasons it waits, warnings, and a rejection's
  reason.
- `withdraw_catalog_proposal`: withdraws your own proposal, by `id`, while
  it waits. Repeating it is harmless.
- `comment_on_catalog_proposal`: a comment on a proposal, by `id`, with
  `text` (at most 4,000 characters) and an `idempotency_key`: for example
  your findings when your person asks you to review one. It informs the
  reviewer; only people approve. `get_catalog_proposal` shows the
  comments, each labelled by who wrote it.

Every answer has an `outcome` and, once stored, the `proposal` with its
`id`, `number` and `state`; a proposal that did not apply has `problems`
instead, each with the `operation` position, a `code` and a `message`.

## Outcomes

- `applied`: the change is a new catalog revision (`applied_revision`);
  mention its number.
- `pending`: it waits for catalog approval; `approval_reasons` says why.
  Tell your person, with the proposal's number; do not send it again.
  Later, `get_catalog_proposal` shows `applied`, `rejected` (with
  `rejection.reason`, from the person who rejected it) or `withdrawn`.
- `conflict`: the entity changed since you read it, so an expectation no
  longer holds. Read it again with `get_entity` and send a new proposal,
  with a new key, from what is there now. Never overwrite another check
  without evidence.
- `invalid`: an operation cannot apply as written; each problem names the
  operation by its position. Fix it and send the proposal again, with a new
  key.
- `blocked`: validation refused the result, for example a link to an entity
  that does not exist, or a credential. Fix the cause.
- `unchanged`: the catalog already says this; nothing to do.

Tool errors: `busy` means Shinan is applying other proposals, or you sent
many in a short time: send the same call, with the same key, after
`retry_after_seconds`. `forbidden` means your token is read-only.
`invalid-input` with `rule: too-complex` means the proposal took too long to
apply: split it.

## Operations

Each operation names its document by ID and states what it expects to find,
taken from `get_entity`. Shinan writes the Markdown from them.

| Operation             | Changes                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `create-entity`       | A new entity: `id` (`<type>/<slug>`), `title`, `summary`, `owner`, `facts`, `body`       |
| `set-fact`            | Writes one `fact` with its `check`; replaces the fact with the same identity, or adds it |
| `remove-fact`         | Removes one fact, named in `expect`                                                      |
| `recheck-facts`       | A new `check` for `facts` whose values did not change                                    |
| `accept-discrepancy`  | Accepts a discrepancy of `key` with a `note` saying why; a person must approve it        |
| `edit-body`           | The whole body, or one `section` by its anchor; `expect` holds the current text          |
| `set-field`           | `title`, `summary`, `status` (`active` or `deprecated`), `owner`, or a decision's fields |
| `retire`              | Retires an entity, naming its replacement in `replacedBy`                                |
| `change-id`           | A new ID of the same type; the old one keeps working as an alias                         |
| `create-schema`       | A new type schema `schema/<type>`                                                        |
| `set-schema-key`      | Adds, changes or removes one key of a type schema                                        |
| `create-start-here`   | The start-here document                                                                  |
| `set-start-here-path` | Replaces the `people` or `agents` path of the start-here document                        |

**A fact** (`fact`) has `key`, `state` and either `value` or, for a relation,
`to` (with `attributes`, such as a checkout's `path`). It may have `via` (how
it was observed), `note` (required for `unknown`), `task` (for `planned`)
and `remove: true` (a planned removal).

**Expectations.** For a fact that should not exist yet, `expect` is
`{ "identity": "<identity>", "absent": true }`. For a fact that exists,
build it from the fact as `get_entity` returned it, with only these fields:
`identity`; `value` as text (`"128"`, `"true"`; for a relation its `to`,
for an `unknown` fact its `note`); `check` with at least `checked` (any of
`by`, `scope`, `source`, `limits` you add must match; `null` for a fact with
no fact check); and every long-form field the fact has (`via`, `note`,
`task`, `remove`, `accepted`, `attributes`). Leave out `key`, `state`,
`freshness`, `label` and the other fields `get_entity` adds: an unknown
field makes the operation `invalid`. A changed fact names the `planned` or
`unknown` fact it settles in `supersedes`, in the same form.

**Identity** is the key, the state and, where needed, what tells facts of
the key apart, joined by `|`: `disk.data.size|observed`,
`disk.data.size|observed|via=smartctl`, `endpoint|intended|value=https://app.example`,
`checkout-on|observed|to=machine/build-1|path=/srv/app`.

An example: a recheck found a machine's data disk larger than recorded.

```json
{
  "explanation": "The data disk was resized to 128 GiB; checked with df after the resize.",
  "related_task": "SHN-12",
  "idempotency_key": "SHN-12-disk-resize",
  "operations": [
    {
      "op": "set-fact",
      "document": "machine/build-1",
      "fact": {
        "key": "disk.data.size",
        "state": "observed",
        "value": "128 GiB"
      },
      "check": {
        "checked": "2026-11-18",
        "scope": "Size of the data disk",
        "source": "df -h /data on build-1"
      },
      "expect": {
        "identity": "disk.data.size|observed",
        "value": "64 GiB",
        "check": { "checked": "2026-10-02" }
      }
    }
  ]
}
```
