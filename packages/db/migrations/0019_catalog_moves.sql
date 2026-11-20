CREATE TABLE "catalog_moves" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"documents" integer NOT NULL,
	"first_commit" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"waiting_proposals" jsonb NOT NULL,
	"problems" jsonb NOT NULL,
	CONSTRAINT "catalog_moves_commit_format" CHECK ("first_commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "catalog_moves_counts" CHECK ("catalog_moves"."revision" >= 0 and "catalog_moves"."documents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_moves" ADD CONSTRAINT "catalog_moves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The record of each move is never changed (Git-based catalog plan §4.1).
CREATE TRIGGER "catalog_moves_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_moves"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_moves_no_truncate"
  BEFORE TRUNCATE ON "catalog_moves"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
