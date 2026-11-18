CREATE TYPE "public"."catalog_proposal_state" AS ENUM('pending', 'applied', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "catalog_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_person_id" uuid,
	"actor_agent_id" uuid,
	"actor_agent_session_id" uuid,
	"actor_label" text NOT NULL,
	"confidence" "attribution_confidence" NOT NULL,
	"explanation" text NOT NULL,
	"related_task" text,
	"operations" jsonb NOT NULL,
	"based_on_revision" integer NOT NULL,
	"state" "catalog_proposal_state" DEFAULT 'pending' NOT NULL,
	"approval_classes" text[] NOT NULL,
	"approval_reasons" jsonb NOT NULL,
	"touches" text[] NOT NULL,
	"validation" jsonb NOT NULL,
	"idempotency_key" text,
	"request_hash" text NOT NULL,
	"applied_revision" integer,
	"decided_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"decided_by_agent_id" uuid,
	"decided_by_label" text,
	"rejection_reason" text,
	CONSTRAINT "catalog_proposals_workspace_id_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "catalog_proposals_workspace_id_number" UNIQUE("workspace_id","number"),
	CONSTRAINT "catalog_proposals_actor_known" CHECK (("catalog_proposals"."actor_kind" not in ('person', 'agent') or "catalog_proposals"."actor_person_id" is not null) and ("catalog_proposals"."actor_kind" <> 'agent' or "catalog_proposals"."actor_agent_id" is not null)),
	CONSTRAINT "catalog_proposals_number_positive" CHECK ("catalog_proposals"."number" > 0),
	CONSTRAINT "catalog_proposals_decided" CHECK (("catalog_proposals"."state" = 'pending') = ("catalog_proposals"."decided_at" is null) and ("catalog_proposals"."decided_at" is null) = ("catalog_proposals"."decided_by_label" is null)),
	CONSTRAINT "catalog_proposals_applied_revision" CHECK (("catalog_proposals"."state" = 'applied') = ("catalog_proposals"."applied_revision" is not null)),
	CONSTRAINT "catalog_proposals_rejection_reason" CHECK (("catalog_proposals"."state" = 'rejected') = ("catalog_proposals"."rejection_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD COLUMN "based_on_revision" integer;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD COLUMN "approved_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD COLUMN "approved_by_label" text;--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD CONSTRAINT "catalog_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD CONSTRAINT "catalog_proposals_actor_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD CONSTRAINT "catalog_proposals_actor_agent_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD CONSTRAINT "catalog_proposals_decided_by_person_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD CONSTRAINT "catalog_proposals_decided_by_agent_id_fk" FOREIGN KEY ("decided_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_proposals_idempotency_key" ON "catalog_proposals" USING btree ("workspace_id","idempotency_key") WHERE "catalog_proposals"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "catalog_proposals_workspace_id_state" ON "catalog_proposals" USING btree ("workspace_id","state");--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_proposal_fk" FOREIGN KEY ("workspace_id","proposal_id") REFERENCES "public"."catalog_proposals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_approved_by_person_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_approver_labelled" CHECK (("catalog_revisions"."approved_by_person_id" is null) = ("catalog_revisions"."approved_by_label" is null));