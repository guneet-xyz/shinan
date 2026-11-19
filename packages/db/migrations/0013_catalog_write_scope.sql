ALTER TABLE "agent_tokens" DROP CONSTRAINT "agent_tokens_known_scopes";--> statement-breakpoint
-- The scope `catalog:propose` is renamed `catalog:write` (Git-based catalog
-- plan §2.14): stored tokens keep the access they had.
UPDATE "agent_tokens" SET "scopes" = array_replace("scopes", 'catalog:propose', 'catalog:write') WHERE 'catalog:propose' = ANY ("scopes");--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_known_scopes" CHECK (cardinality("agent_tokens"."scopes") > 0 and "agent_tokens"."scopes" <@ array['catalog:read', 'catalog:write', 'tasks:read', 'tasks:write', 'presence']::text[]);
