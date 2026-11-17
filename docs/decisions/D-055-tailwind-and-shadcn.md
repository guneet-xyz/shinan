---
id: D-055
title: The web app uses Tailwind CSS and shadcn/ui components
status: accepted
date: 2026-11-17
decided_by: owner
evidence: "Owner, on 2026-11-17; recorded on https://github.com/guneet-xyz/shinan/issues/75"
supersedes: []
superseded_by: []
amends: []
amended_by: []
---

# D-055: The web app uses Tailwind CSS and shadcn/ui components

Status: **Accepted** by the owner on 2026-11-17 (recorded on
[issue #75](https://github.com/guneet-xyz/shinan/issues/75)).

## Context

- The web app shell (M1-5, [PR #62](https://github.com/guneet-xyz/shinan/pull/62))
  proposed one plain stylesheet (`apps/web/src/styles.css`) with no CSS
  framework or design system. No decision record covered it.
- M1 has a handful of screens; M2 and M3 add many more (wiki, catalog, tasks,
  the Now screen), built from the same forms, dialogs, lists and menus
  ([build plan §1](../build-plan.md#1-what-gets-built)).
- [shadcn/ui](https://ui.shadcn.com/docs) is a set of React components that a
  command copies into the project's own source, styled with
  [Tailwind CSS](https://tailwindcss.com/docs). Its documented setup for an
  existing Vite project adds Tailwind CSS through its Vite plugin and then
  runs `shadcn init` ([docs](https://ui.shadcn.com/docs/installation/vite),
  checked 2026-11-17). The components are built on
  [Base UI](https://base-ui.com/react/overview/quick-start) or Radix; `init`
  asks which.
- Every answer carries a Content Security Policy with no inline scripts or
  styles ([architecture §10.2](../architecture.md#102-web-hardening),
  [security checklist](../security-checklist.md) 1.4 and 1.5). Some Base UI
  components add an inline `<style>` tag (a scroll area and some selects, to
  hide scroll bars); Base UI's `CSPProvider` turns those tags off
  ([docs](https://base-ui.com/react/utils/csp-provider), checked 2026-11-17).
  Its dialogs lock page scrolling by setting styles from script, which the
  policy allows.
- Owner projects using Tailwind CSS format their code with
  `prettier-plugin-tailwindcss`, last in the plugin list, as the owner's
  [Prettier decision](https://git.guneet.dev/guneet/workspace/src/branch/main/decisions/prettier-configuration.md)
  says.

## Decision

The web app is styled with Tailwind CSS and built from shadcn/ui components,
copied into `apps/web/src/components/ui` as shadcn intends. The M1 screens
are redesigned with them before M2, and later screens use them too.

## Reasons

The owner wants shadcn components because they look better.

## Notes

- **Proposed** (M1-8, [#75](https://github.com/guneet-xyz/shinan/issues/75)):
  the setup choices, which do not change this decision, are in the
  [architecture](../architecture.md#21-decided-stack) and the README: Base UI
  as the component base, the `vega` style with the neutral base colour, light
  and dark following the device's setting, and Base UI's inline style tags
  turned off.

## Consequences

- **Decided:** the plain stylesheet is gone; screens use Tailwind CSS utility
  classes and the shared components. Prettier sorts the classes
  (`prettier-plugin-tailwindcss`).
- **Decided:** the strict Content Security Policy is unchanged. A component
  that needs an inline `<style>` or script tag must have it turned off or
  replaced by a rule in the stylesheet; weakening the policy is a separate
  decision ([security checklist](../security-checklist.md) 1.4, 1.5).
- **Decided:** shadcn/ui components are part of this repository's code: they
  are reviewed, changed and updated like any other file, not as a dependency.

## Alternatives considered

- **Recorded:** one plain stylesheet with no framework (the M1-5 proposal).
  Not chosen.

## Owning documents

- [Architecture and operations](../architecture.md#21-decided-stack): the
  web app's stack.
- [Build plan](../build-plan.md#5-m1-work-packages): the M1-8 work package.

## Related open questions

None.

## History

- 2026-11-17: accepted by the owner; recorded on
  [issue #75](https://github.com/guneet-xyz/shinan/issues/75).
