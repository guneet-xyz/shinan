-- Events and the security log are append-only. The security log is kept
-- forever and no entry can ever be purged (D-049). Events can be purged later
-- (architecture §4.4); purge will narrow the events triggers in its own
-- migration. Triggers stop the application and anyone using its database
-- role by mistake; a database owner or superuser can still disable them,
-- the residual risk identity §11 states.
CREATE FUNCTION "shinan_refuse_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "security_log_append_only"
  BEFORE UPDATE OR DELETE ON "security_log"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "security_log_no_truncate"
  BEFORE TRUNCATE ON "security_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "events_append_only"
  BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION "shinan_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "events_no_truncate"
  BEFORE TRUNCATE ON "events"
  FOR EACH STATEMENT EXECUTE FUNCTION "shinan_refuse_change"();
