ALTER TABLE "catalog_index_state" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "catalog_index_state" ADD COLUMN "failed_at" timestamp with time zone;