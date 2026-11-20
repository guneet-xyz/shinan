ALTER TABLE "agent_tokens" ADD COLUMN "fetch_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD COLUMN "fetch_summarized_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD COLUMN "last_fetched_at" timestamp with time zone;