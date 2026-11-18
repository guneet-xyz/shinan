CREATE TABLE "catalog_index_provenance" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_version" integer NOT NULL,
	"authors" jsonb NOT NULL,
	"units" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_index_documents" ADD COLUMN "rules_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_index_state" ADD COLUMN "rules_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_index_provenance" ADD CONSTRAINT "catalog_index_provenance_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."catalog_index_documents"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_index_provenance_workspace_id" ON "catalog_index_provenance" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "catalog_index_documents_versions" ON "catalog_index_documents" USING btree ("workspace_id","parser_version","rules_version");