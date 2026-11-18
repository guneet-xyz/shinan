CREATE TABLE "catalog_proposal_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_person_id" uuid,
	"actor_agent_id" uuid,
	"actor_agent_session_id" uuid,
	"actor_label" text NOT NULL,
	"confidence" "attribution_confidence" NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "catalog_proposal_comments_actor_known" CHECK (("catalog_proposal_comments"."actor_kind" not in ('person', 'agent') or "catalog_proposal_comments"."actor_person_id" is not null) and ("catalog_proposal_comments"."actor_kind" <> 'agent' or "catalog_proposal_comments"."actor_agent_id" is not null)),
	CONSTRAINT "catalog_proposal_comments_text_not_blank" CHECK (btrim("catalog_proposal_comments"."text") <> '')
);
--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD COLUMN "reverts_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "catalog_strict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_proposal_comments" ADD CONSTRAINT "catalog_proposal_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposal_comments" ADD CONSTRAINT "catalog_proposal_comments_proposal_fk" FOREIGN KEY ("workspace_id","proposal_id") REFERENCES "public"."catalog_proposals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposal_comments" ADD CONSTRAINT "catalog_proposal_comments_actor_person_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposal_comments" ADD CONSTRAINT "catalog_proposal_comments_actor_agent_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_proposal_comments_proposal_id" ON "catalog_proposal_comments" USING btree ("proposal_id","created_at");--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD CONSTRAINT "catalog_proposals_reverts_fk" FOREIGN KEY ("workspace_id","reverts_proposal_id") REFERENCES "public"."catalog_proposals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_proposals_reverts_proposal_id" ON "catalog_proposals" USING btree ("reverts_proposal_id");--> statement-breakpoint
CREATE INDEX "catalog_proposals_touches" ON "catalog_proposals" USING gin ("touches");