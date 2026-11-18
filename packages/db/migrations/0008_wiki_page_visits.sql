CREATE TABLE "catalog_page_visits" (
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_page_visits_workspace_id_person_id_document_id_pk" PRIMARY KEY("workspace_id","person_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_page_visits" ADD CONSTRAINT "catalog_page_visits_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_page_visits" ADD CONSTRAINT "catalog_page_visits_document_fk" FOREIGN KEY ("workspace_id","document_id") REFERENCES "public"."catalog_documents"("workspace_id","id") ON DELETE no action ON UPDATE no action;