# The built-in types

<!-- Generated from Shinan's built-in type schemas by `pnpm --filter @shinan/skill generate`. Do not edit by hand. -->

Built-in types have no schema document in the repository. Their keys and
recheck intervals are below; a workspace may add keys to one in
`schema/<type>.md`, and custom types are defined the same way.

- **Recheck:** a fact of the key is due for recheck once this many days
  have passed since its `checked`; "none" means it is never due, though
  its age still matters.
- **Values:** "one" keys hold a single value, "many" a list. Two
  observations of a "one" key by different means each need their own
  `via`.
- **Relations** hold entity IDs of the types named, in short form
  (`runs-on: machine/build-1`) or as `{ to: …, <attribute>: … }`.
  Identified by: the attributes that, with the target, tell two facts of
  the key apart.
- **Required** keys are what an agent needs before relying on the entity;
  a document without them is valid, and they are listed as not yet
  recorded.

## project

Required: `repository`. Body sections: Role, Cautions, Cross-project context.

| Key                       | Values | Relation to | Identified by | Recheck  |
| ------------------------- | ------ | ----------- | ------------- | -------- |
| `repository`              | many   |             |               | 180 days |
| `docs.readme`             | one    |             |               | 180 days |
| `docs.agent_instructions` | one    |             |               | 180 days |
| `docs.deployment`         | one    |             |               | 180 days |
| `issue_tracker`           | one    |             |               | 180 days |
| `release.latest`          | one    |             |               | 30 days  |
| `checkout-on`             | many   | `machine`   | `path`        | 30 days  |
| `provides`                | many   | `service`   |               | 90 days  |
| `depends-on`              | many   | `service`   |               | 90 days  |
| `secrets-in`              | many   | `service`   | `item`        | 90 days  |

## machine

Required: `role`, `environment`, `access.method`. Body sections: Identity and role, Access prerequisites, Operational constraints, Cautions.

| Key                | Values | Relation to | Identified by | Recheck  |
| ------------------ | ------ | ----------- | ------------- | -------- |
| `role`             | one    |             |               | 180 days |
| `environment`      | one    |             |               | 180 days |
| `provider`         | one    |             |               | 365 days |
| `platform.os`      | one    |             |               | 90 days  |
| `platform.arch`    | one    |             |               | none     |
| `platform.vm_size` | one    |             |               | 90 days  |
| `access.method`    | one    |             |               | 90 days  |
| `access.address`   | one    |             |               | 30 days  |
| `access.host_key`  | one    |             |               | 90 days  |
| `hostname`         | one    |             |               | 180 days |
| `disk.root.size`   | one    |             |               | 30 days  |
| `disk.root.used`   | one    |             |               | 7 days   |
| `disk.root.free`   | one    |             |               | 7 days   |
| `disk.data.size`   | one    |             |               | 30 days  |
| `disk.data.used`   | one    |             |               | 7 days   |
| `disk.data.free`   | one    |             |               | 7 days   |
| `configured-by`    | many   | `project`   |               | 180 days |
| `on-network`       | many   | `service`   |               | 90 days  |
| `secrets-in`       | many   | `service`   | `item`        | 90 days  |

## service

Required: `endpoint`, `environment`. Body sections: Role and authority, Dependencies and operational context, Cautions.

| Key                     | Values | Relation to | Identified by | Recheck  |
| ----------------------- | ------ | ----------- | ------------- | -------- |
| `endpoint`              | many   |             |               | 30 days  |
| `environment`           | one    |             |               | 180 days |
| `deployment.version`    | one    |             |               | 14 days  |
| `deployment.built_from` | one    |             |               | 30 days  |
| `provided-by`           | one    |             |               | 365 days |
| `runs-on`               | many   | `machine`   |               | 30 days  |
| `configured-by`         | many   | `project`   |               | 180 days |
| `depends-on`            | many   | `service`   |               | 90 days  |
| `secrets-in`            | many   | `service`   | `item`        | 90 days  |

## runbook

Required: `last_successful_run`, `changes_deployment`, `applies-to`. Body sections: Purpose and owning sources, Targets and prerequisites, Expected impact, Procedure, Verification, Rollback and escalation.

| Key                   | Values | Relation to                                | Identified by | Recheck  |
| --------------------- | ------ | ------------------------------------------ | ------------- | -------- |
| `last_successful_run` | one    |                                            |               | none     |
| `changes_deployment`  | one    |                                            |               | 365 days |
| `applies-to`          | many   | any entity, `schema/<type>` or `workspace` |               | none     |

## decision

Required: none. Body sections: Context, Decision, Alternatives and reasons, Consequences, Replacement.

| Key          | Values | Relation to                                | Identified by | Recheck |
| ------------ | ------ | ------------------------------------------ | ------------- | ------- |
| `supersedes` | many   | `decision`                                 |               | none    |
| `applies-to` | many   | any entity, `schema/<type>` or `workspace` |               | none    |
| `from-task`  | many   | a task ID                                  |               | none    |

## policy

Required: `enforcement`, `applies-to`. Body sections: Rule, Why, What it covers, Exceptions.

| Key           | Values | Relation to                                | Identified by | Recheck |
| ------------- | ------ | ------------------------------------------ | ------------- | ------- |
| `enforcement` | one    |                                            |               | 90 days |
| `applies-to`  | many   | any entity, `schema/<type>` or `workspace` |               | none    |
| `see-also`    | many   | `runbook`                                  |               | none    |

## person

Required: none. Body sections: Responsibilities.

| Key      | Values | Relation to | Identified by | Recheck |
| -------- | ------ | ----------- | ------------- | ------- |
| `member` | one    |             |               | none    |

## agent

Required: `agent_record`, `on-machine`. Body sections: Use, Conventions.

| Key            | Values | Relation to | Identified by | Recheck  |
| -------------- | ------ | ----------- | ------------- | -------- |
| `agent_record` | one    |             |               | none     |
| `on-machine`   | one    | `machine`   |               | 180 days |
