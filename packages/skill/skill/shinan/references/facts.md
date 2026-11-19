# Facts, fact checks and provenance

What you write into the catalog must say how it is known. You write it by
hand, in the document's frontmatter; Shinan checks it when you push.

## The format

`facts` is a list of groups. A fact check group holds one act of checking
and the facts it covers, by state; a group without a fact check holds
`planned` facts, or `unknown` facts nobody has looked at.

```yaml
facts:
  - checked: 2026-11-18T09:42:17Z
    by: alex via opencode-build-1
    scope: Size and use of the data disk after the resize
    source: df -h /data on build-1
    limits: The root disk was not checked
    observed:
      disk.data.size: 128 GiB
      disk.data.used: { value: 41 GiB, via: df }
  - planned:
      endpoint: { value: https://app.example/, task: SHN-12 }
  - unknown:
      backup.freshness: Backups are paused; no restore test
```

- **Short form** `key: value`; **long form** `key: { value: …, via: …,
note: …, task: …, remove: true }`. A relation names its target with `to`,
  and any other field of it is an attribute (`path`, `item`):
  `checkout-on: [{ to: machine/build-1, path: /srv/app }]`. An attribute is
  never named like a fact check field (`checked`, `by`, `scope`, `source`,
  `limits`).
- A multi-valued key holds a list (or one value); a single-valued key never
  holds a list. [types.md](types.md) says which keys are which.
- In an `unknown` list, the value is a short note saying why it is unknown.
- A fact appears in exactly one group. Drop a group that is left empty.

## Fact states

| State      | Use it when                                                       | Fact check | Source                                                                                     |
| ---------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `intended` | The owning source (a repository, a configuration) declares it now | Required   | The owning source, pinned to a revision (a commit or tag) where possible                   |
| `observed` | You saw it yourself when you checked                              | Required   | What you looked at, how and from where, such as `df -h on the machine`                     |
| `planned`  | It is agreed but not yet in the owning source                     | None       | `task` on the fact: the task ID or accepted `decision` entity behind it                    |
| `unknown`  | You looked and could not tell, or nobody has looked               | Optional   | `note` on the fact says why it is unknown; with a fact check when you looked and could not |

- A `planned` fact can plan a removal with `remove: true`.
- A `planned` or `unknown` fact never becomes true by itself: when the change
  lands or the value is found, write the `intended` or `observed` fact and
  remove the fact it settles, in the same commit.
- A change that is merged but not yet applied is `intended`; what you see in
  the world is `observed`. If they differ, both stay, as a discrepancy. Do
  not hide drift by writing only one.

## Writing a fact check

A fact check records one act of checking; facts you checked together share
one group.

- `checked`: **the real time of the check, never rounded**, and never the
  time you write or push the change. Take it when you look, for example with
  `date -u +%Y-%m-%dT%H:%M:%SZ` run right after the command that showed you
  the value, and copy it as it is. A date alone (`2026-11-18`) is allowed
  when you only know the day. A time needs its UTC offset (`Z` or `+01:00`).
  A time in the future is refused.
- `by`: **exactly your written form, `<person handle> via <agent handle>`**,
  such as `alex via opencode-build-1`. `git config --global --get shinan.by`
  gives it on a machine set up for Shinan. Shinan refuses a push whose new or
  changed fact check names anyone else, and the refusal says the form it
  expected. Never write another member's or agent's name, or your person's
  handle alone.
- `scope`: what exactly you checked, in one line.
- `source`: where the evidence is: a pinned URL, a repository revision, or a
  short description of the observation. Never raw logs or sensitive output.
- `limits`: what you did not or could not check, in one line, when it
  matters.
- `accepted` (on a fact of a discrepancy) names the `person` entity who
  accepted the difference, with the reason in the fact's `note`. Write it
  only when that person told you so, in this task; never on your own
  judgment.

## Rechecks and other people's fact checks

- **A recheck** that found the same value: move the fact out of its old
  group into a new group of your own with the time you checked; leave the
  old group's other facts where they are. Never change the `checked` of a
  group you did not just check, and never add a fact to someone else's
  group.
- **A changed value** of the same fact (same key, state and `via`): replace
  the old fact with the new one in your own group. A value seen by other
  means gets its own `via` and stays beside the old one.
- **Another agent's or member's fact check** stays exactly as it is. You may
  remove facts from it (when you replace or remove them), and you may move a
  whole document unchanged, but any other edit to it makes it a changed fact
  check that names someone else, and the push is refused.
- **Nothing is removed by omission.** A value that no longer holds is
  removed on purpose, in a commit that says why.

## Provenance

- **Copying is not checking.** A value you read in another document, in the
  catalog itself, in a README, in a message or in an earlier session is not
  a check of the fact. At most it tells you where to check.
- **`unknown` over guesses.** If you could not check a fact, write it as
  `unknown` with a note saying why, or leave it out. A guessed fact is worse
  than a known gap, because nobody rechecks it.
- **Check one fact, refresh one fact.** Rechecking a fact records a new fact
  check for that fact only. Never refresh dates you did not check, and never
  claim a whole entity was checked when you checked one fact.
- **Evidence over arrival order.** When values compete, the fact check
  (what was seen, from where, and when) decides, not which commit came last.
  Two values with valid fact checks may both stay, as a discrepancy; give a
  second observation its own `via` (how it was observed).
- **Link, don't copy.** For something another system owns, record a pointer
  to it (a URL or repository), not a copy of its contents.
- **Secrets stay where they live.** Record where a secret lives, never its
  value: a `secrets-in` relation to the secrets manager's `service` entity,
  with `item` naming the entry (such as `app/production/database`) and a
  `note` saying what it is for. Never write a credential, key, token or a URL
  with a password in it. Shinan refuses a push holding text that is almost
  certainly a credential, and warns about text that only looks like one;
  neither is a reason to rephrase a secret until it passes.
