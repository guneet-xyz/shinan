CREATE TABLE "catalog_index_provenance" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_version" integer NOT NULL,
	"authors" jsonb NOT NULL,
	"units" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_index_provenance" ADD CONSTRAINT "catalog_index_provenance_document_fk" FOREIGN KEY ("document_id") REFERENCES "public"."catalog_index_documents"("document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_index_provenance_workspace_id" ON "catalog_index_provenance" USING btree ("workspace_id");--> statement-breakpoint
-- `written_by` now comes from the documents' word provenance (catalog
-- §12.4), so every index built before is rebuilt from its text: answers
-- say the index is behind until the worker has done so.
UPDATE "catalog_index_state" SET "rebuild_requested_at" = now() WHERE "rebuild_requested_at" IS NULL;
