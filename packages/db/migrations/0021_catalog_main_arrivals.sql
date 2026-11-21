CREATE TABLE "catalog_main_arrivals" (
	"workspace_id" uuid NOT NULL,
	"commit" text NOT NULL,
	"push_id" uuid,
	"reached_main_at" timestamp with time zone NOT NULL,
	CONSTRAINT "catalog_main_arrivals_workspace_id_commit_pk" PRIMARY KEY("workspace_id","commit"),
	CONSTRAINT "catalog_main_arrivals_commit" CHECK ("commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$')
);
--> statement-breakpoint
ALTER TABLE "catalog_main_arrivals" ADD CONSTRAINT "catalog_main_arrivals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_main_arrivals" ADD CONSTRAINT "catalog_main_arrivals_push_id_catalog_pushes_id_fk" FOREIGN KEY ("push_id") REFERENCES "public"."catalog_pushes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "catalog_main_arrivals_append_only"
  BEFORE UPDATE OR DELETE ON "catalog_main_arrivals"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "catalog_main_arrivals_no_truncate"
  BEFORE TRUNCATE ON "catalog_main_arrivals"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
-- What the push log already shows reached `main`: the commits Shinan made
-- (a repository's first); the commits first pushed to `main` (first
-- pushes are recorded only for applied updates, so that push brought them
-- to `main`), the earliest any push could; and each commit an applied
-- update moved `main` to, at that push's time. A commit's earliest
-- arrival is inserted first and kept. Commits a merge brought along from
-- a branch, before this release recorded them, have no arrival.
INSERT INTO "catalog_main_arrivals" ("workspace_id", "commit", "push_id", "reached_main_at")
SELECT "workspace_id", "commit", NULL, "first_pushed_at"
FROM "catalog_commit_first_pushes"
WHERE "pusher_kind" = 'shinan' AND "replaces_commit" IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "catalog_main_arrivals" ("workspace_id", "commit", "push_id", "reached_main_at")
SELECT "workspace_id", "commit", "push_id", "first_pushed_at"
FROM "catalog_commit_first_pushes"
WHERE "ref" = 'refs/heads/main' AND "pusher_kind" = 'agent' AND "replaces_commit" IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "catalog_main_arrivals" ("workspace_id", "commit", "push_id", "reached_main_at")
SELECT DISTINCT ON (p."workspace_id", r."new_commit") p."workspace_id", r."new_commit", p."id", p."pushed_at"
FROM "catalog_push_refs" r
JOIN "catalog_pushes" p ON p."id" = r."push_id"
WHERE r."ref" = 'refs/heads/main' AND r."confirmed" AND p."outcome" = 'accepted' AND r."new_commit" IS NOT NULL
ORDER BY p."workspace_id", r."new_commit", p."pushed_at"
ON CONFLICT DO NOTHING;
