CREATE TABLE "catalog_repositories" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone,
	"first_commit" text,
	CONSTRAINT "catalog_repositories_created_with_commit" CHECK (("catalog_repositories"."created_at" is null) = ("catalog_repositories"."first_commit" is null)),
	CONSTRAINT "catalog_repositories_commit_format" CHECK ("catalog_repositories"."first_commit" is null or "catalog_repositories"."first_commit" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$')
);
--> statement-breakpoint
ALTER TABLE "catalog_repositories" ADD CONSTRAINT "catalog_repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;