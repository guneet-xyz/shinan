--
-- PostgreSQL database dump
--


-- Dumped from database version 18.7
-- Dumped by pg_dump version 18.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: pgboss; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgboss;


--
-- Name: job_state; Type: TYPE; Schema: pgboss; Owner: -
--

CREATE TYPE pgboss.job_state AS ENUM (
    'created',
    'retry',
    'active',
    'completed',
    'cancelled',
    'failed'
);


--
-- Name: actor_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.actor_kind AS ENUM (
    'person',
    'agent',
    'shinan',
    'outside',
    'unknown'
);


--
-- Name: attribution_confidence; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attribution_confidence AS ENUM (
    'recorded',
    'marked',
    'inferred',
    'unknown'
);


--
-- Name: catalog_proposal_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.catalog_proposal_state AS ENUM (
    'pending',
    'applied',
    'rejected',
    'withdrawn'
);


--
-- Name: email_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_kind AS ENUM (
    'magic_link',
    'invitation',
    'security_alert',
    'email_change'
);


--
-- Name: email_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_status AS ENUM (
    'queued',
    'sent',
    'rejected',
    'given_up',
    'throttled'
);


--
-- Name: event_origin; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.event_origin AS ENUM (
    'shinan_action',
    'webhook',
    'reconciliation',
    'plugin_report',
    'mcp_call'
);


--
-- Name: invitation_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invitation_state AS ENUM (
    'pending',
    'accepted',
    'declined',
    'expired',
    'withdrawn'
);


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'owner',
    'contributor'
);


--
-- Name: security_outcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.security_outcome AS ENUM (
    'succeeded',
    'refused',
    'failed'
);


--
-- Name: create_queue(text, jsonb); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.create_queue(queue_name text, options jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $_$
    DECLARE
      tablename varchar := CASE WHEN options->>'partition' = 'true'
                            THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                            ELSE 'job_common'
                            END;
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
        INSERT INTO pgboss.queue (
          name,
          policy,
          retry_limit,
          retry_delay,
          retry_backoff,
          retry_delay_max,
          expire_seconds,
          retention_seconds,
          deletion_seconds,
          warning_queued,
          dead_letter,
          partition,
          table_name,
          heartbeat_seconds,
          notify,
          created_on,
          updated_on
        )
        VALUES (
          queue_name,
          options->>'policy',
          COALESCE((options->>'retryLimit')::int, 2),
          COALESCE((options->>'retryDelay')::int, 0),
          COALESCE((options->>'retryBackoff')::bool, false),
          (options->>'retryDelayMax')::int,
          COALESCE((options->>'expireInSeconds')::int, 900),
          COALESCE((options->>'retentionSeconds')::int, 1209600),
          COALESCE((options->>'deleteAfterSeconds')::int, 604800),
          COALESCE((options->>'warningQueueSize')::int, 0),
          options->>'deadLetter',
          COALESCE((options->>'partition')::bool, false),
          tablename,
          (options->>'heartbeatSeconds')::int,
          COALESCE((options->>'notify')::bool, false),
          pgboss.job_now(),
          pgboss.job_now()
        )
        ON CONFLICT DO NOTHING
        RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', tablename);

      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);

      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i11 ON pgboss.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i9 ON pgboss.job (name, id) WHERE blocking AND state = 'completed'$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i12 ON pgboss.job (source_root_id) WHERE source_root_id IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i13 ON pgboss.job (name, singleton_key) WHERE state = 'created' AND upsert_by_key$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i14 ON pgboss.job (name, state, blocked, start_after) WHERE state IN ('created', 'retry', 'active', 'failed')$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i15 ON pgboss.job (name, created_on)$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i16 ON pgboss.job (name, completed_on) WHERE completed_on IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i17 ON pgboss.job (name, singleton_key, created_on) WHERE state < 'active' AND singleton_key IS NOT NULL$cmd$, tablename);

      IF options->>'policy' = 'short' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, tablename);
      ELSIF options->>'policy' = 'singleton' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, tablename);
      ELSIF options->>'policy' = 'stately' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, tablename);
      ELSIF options->>'policy' = 'exclusive' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, tablename);
      ELSIF options->>'policy' = 'key_strict_fifo' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i10 ON pgboss.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, tablename);
      END IF;

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', tablename, queue_name);
    END;
    $_$;


--
-- Name: delete_queue(text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.delete_queue(queue_name text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_table varchar;
      v_partition bool;
    BEGIN
      
      SELECT table_name, partition
      FROM pgboss.queue
      WHERE name = queue_name
      INTO v_table, v_partition;

      IF v_partition THEN
        EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', v_table);
      ELSE
        EXECUTE format('DELETE FROM pgboss.%I WHERE name = %L', v_table, queue_name);
      END IF;
    
      DELETE FROM pgboss.queue WHERE name = queue_name;
    END;
    $$;


--
-- Name: job_now(); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.job_now() RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    AS $$
      SELECT pg_catalog.now();
    $$;


--
-- Name: job_table_format(text, text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.job_table_format(command text, table_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
      SELECT format(
        regexp_replace(
          regexp_replace(command, '\.job\y', '.%1$I', 'g'),
          '\yjob_i(\d+)', '%1$s_i\1', 'g'
        ),
        table_name
      );
    $_$;


--
-- Name: job_table_run(text, text, text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.job_table_run(command text, tbl_name text DEFAULT NULL::text, queue_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      tbl RECORD;
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        EXECUTE pgboss.job_table_format(command, tbl_name);
        RETURN;
      END IF;

      EXECUTE pgboss.job_table_format(command, 'job_common');

      FOR tbl IN SELECT table_name FROM pgboss.queue WHERE partition = true
      LOOP
        EXECUTE pgboss.job_table_format(command, tbl.table_name);
      END LOOP;
    END;
    $$;


--
-- Name: job_table_run_async(text, integer, text, text, text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.job_table_run_async(command_name text, version integer, command text, tbl_name text DEFAULT NULL::text, queue_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
        VALUES (
          command_name,
          version,
          'pending',
          queue_name,
          tbl_name,
          pgboss.job_table_format(command, tbl_name)
        );
        RETURN;
      END IF;

      INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
      SELECT
        command_name,
        version,
        'pending',
        NULL,
        'job_common',
        pgboss.job_table_format(command, 'job_common')
      UNION ALL
      SELECT
        command_name,
        version,
        'pending',
        queue.name,
        queue.table_name,
        pgboss.job_table_format(command, queue.table_name)
      FROM pgboss.queue
      WHERE partition = true;
    END;
    $$;


--
-- Name: shinan_refuse_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shinan_refuse_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


--
-- Name: shinan_refuse_change_except_purge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shinan_refuse_change_except_purge() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - TG_ARGV) = (to_jsonb(OLD) - TG_ARGV)
    AND EXISTS (
      SELECT 1 FROM "catalog_purges" p
      WHERE p."workspace_id" = OLD."workspace_id"
        AND p."transaction_id" = pg_current_xact_id()
    )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


--
-- Name: shinan_refuse_purge_record_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shinan_refuse_purge_record_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."transaction_id" = pg_current_xact_id()
    AND (to_jsonb(NEW) - 'counts') = (to_jsonb(OLD) - 'counts')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: bam; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.bam (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    queue text,
    table_name text NOT NULL,
    command text NOT NULL,
    error text,
    created_on timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    started_on timestamp with time zone,
    completed_on timestamp with time zone
);


--
-- Name: instance; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.instance (
    id uuid NOT NULL,
    name text,
    host text NOT NULL,
    pid integer NOT NULL,
    version text NOT NULL,
    node_version text NOT NULL,
    application_name text,
    heartbeat_seconds integer NOT NULL,
    supervise boolean NOT NULL,
    schedule boolean NOT NULL,
    migrate boolean NOT NULL,
    persist_queue_stats boolean NOT NULL,
    persist_warnings boolean NOT NULL,
    pool_max integer,
    pool_total integer,
    pool_idle integer,
    pool_waiting integer,
    workers jsonb DEFAULT '[]'::jsonb NOT NULL,
    metrics jsonb,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    crash_restarts integer DEFAULT 0 NOT NULL,
    crash_restarts_since timestamp with time zone,
    started_on timestamp with time zone DEFAULT now() NOT NULL,
    heartbeat_on timestamp with time zone DEFAULT now() NOT NULL,
    stopped_on timestamp with time zone
);


--
-- Name: job; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    retry_delay_max integer,
    expire_seconds integer DEFAULT 900 NOT NULL,
    deletion_seconds integer DEFAULT 604800 NOT NULL,
    singleton_key text,
    singleton_on timestamp without time zone,
    group_id text,
    group_tier text,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '336:00:00'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    heartbeat_on timestamp with time zone,
    heartbeat_seconds integer,
    blocked boolean DEFAULT false NOT NULL,
    blocking boolean DEFAULT false NOT NULL,
    pending_dependencies integer DEFAULT 0 NOT NULL,
    source_name text,
    source_id uuid,
    source_created_on timestamp with time zone,
    source_retry_count integer,
    source_output jsonb,
    source_root_id uuid,
    trace_context jsonb,
    upsert_by_key boolean
)
PARTITION BY LIST (name);


--
-- Name: job_common; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job_common (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT job_id_not_null NOT NULL,
    name text CONSTRAINT job_name_not_null NOT NULL,
    priority integer DEFAULT 0 CONSTRAINT job_priority_not_null NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state CONSTRAINT job_state_not_null NOT NULL,
    retry_limit integer DEFAULT 2 CONSTRAINT job_retry_limit_not_null NOT NULL,
    retry_count integer DEFAULT 0 CONSTRAINT job_retry_count_not_null NOT NULL,
    retry_delay integer DEFAULT 0 CONSTRAINT job_retry_delay_not_null NOT NULL,
    retry_backoff boolean DEFAULT false CONSTRAINT job_retry_backoff_not_null NOT NULL,
    retry_delay_max integer,
    expire_seconds integer DEFAULT 900 CONSTRAINT job_expire_seconds_not_null NOT NULL,
    deletion_seconds integer DEFAULT 604800 CONSTRAINT job_deletion_seconds_not_null NOT NULL,
    singleton_key text,
    singleton_on timestamp without time zone,
    group_id text,
    group_tier text,
    start_after timestamp with time zone DEFAULT now() CONSTRAINT job_start_after_not_null NOT NULL,
    created_on timestamp with time zone DEFAULT now() CONSTRAINT job_created_on_not_null NOT NULL,
    started_on timestamp with time zone,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '336:00:00'::interval) CONSTRAINT job_keep_until_not_null NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    heartbeat_on timestamp with time zone,
    heartbeat_seconds integer,
    blocked boolean DEFAULT false CONSTRAINT job_blocked_not_null NOT NULL,
    blocking boolean DEFAULT false CONSTRAINT job_blocking_not_null NOT NULL,
    pending_dependencies integer DEFAULT 0 CONSTRAINT job_pending_dependencies_not_null NOT NULL,
    source_name text,
    source_id uuid,
    source_created_on timestamp with time zone,
    source_retry_count integer,
    source_output jsonb,
    source_root_id uuid,
    trace_context jsonb,
    upsert_by_key boolean,
    CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK ((NOT ((policy = 'key_strict_fifo'::text) AND (singleton_key IS NULL))))
);


--
-- Name: job_dependency; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job_dependency (
    child_name text NOT NULL,
    child_id uuid NOT NULL,
    parent_name text NOT NULL,
    parent_id uuid NOT NULL
);


--
-- Name: queue; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue (
    name text NOT NULL,
    policy text NOT NULL,
    retry_limit integer NOT NULL,
    retry_delay integer NOT NULL,
    retry_backoff boolean NOT NULL,
    retry_delay_max integer,
    expire_seconds integer NOT NULL,
    retention_seconds integer NOT NULL,
    deletion_seconds integer NOT NULL,
    dead_letter text,
    partition boolean NOT NULL,
    table_name text NOT NULL,
    deferred_count integer DEFAULT 0 NOT NULL,
    blocked_count integer DEFAULT 0 NOT NULL,
    queued_count integer DEFAULT 0 NOT NULL,
    ready_count integer DEFAULT 0 NOT NULL,
    warning_queued integer DEFAULT 0 NOT NULL,
    active_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    retained_count integer,
    retained_on timestamp with time zone,
    created_delta integer DEFAULT 0 NOT NULL,
    completed_delta integer DEFAULT 0 NOT NULL,
    failed_delta integer DEFAULT 0 NOT NULL,
    delta_on timestamp with time zone,
    delta_seconds integer,
    wait_bins integer[],
    run_bins integer[],
    ready_oldest_seconds integer,
    ready_history integer[] DEFAULT '{}'::integer[] NOT NULL,
    heartbeat_seconds integer,
    notify boolean DEFAULT false NOT NULL,
    singletons_active text[],
    monitor_claim_on timestamp with time zone,
    monitor_on timestamp with time zone,
    maintain_on timestamp with time zone,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT queue_check CHECK ((dead_letter IS DISTINCT FROM name))
);


--
-- Name: queue_stats; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    deferred_count integer DEFAULT 0 NOT NULL,
    queued_count integer DEFAULT 0 NOT NULL,
    ready_count integer DEFAULT 0 NOT NULL,
    active_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    created_delta integer,
    completed_delta integer,
    failed_delta integer,
    delta_seconds integer,
    delta_on timestamp with time zone,
    wait_bins integer[],
    run_bins integer[],
    ready_oldest_seconds integer,
    captured_on timestamp with time zone DEFAULT now() NOT NULL
)
PARTITION BY RANGE (captured_on);


--
-- Name: queue_stats_20261120; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue_stats_20261120 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT queue_stats_id_not_null NOT NULL,
    name text CONSTRAINT queue_stats_name_not_null NOT NULL,
    deferred_count integer DEFAULT 0 CONSTRAINT queue_stats_deferred_count_not_null NOT NULL,
    queued_count integer DEFAULT 0 CONSTRAINT queue_stats_queued_count_not_null NOT NULL,
    ready_count integer DEFAULT 0 CONSTRAINT queue_stats_ready_count_not_null NOT NULL,
    active_count integer DEFAULT 0 CONSTRAINT queue_stats_active_count_not_null NOT NULL,
    failed_count integer DEFAULT 0 CONSTRAINT queue_stats_failed_count_not_null NOT NULL,
    total_count integer DEFAULT 0 CONSTRAINT queue_stats_total_count_not_null NOT NULL,
    created_delta integer,
    completed_delta integer,
    failed_delta integer,
    delta_seconds integer,
    delta_on timestamp with time zone,
    wait_bins integer[],
    run_bins integer[],
    ready_oldest_seconds integer,
    captured_on timestamp with time zone DEFAULT now() CONSTRAINT queue_stats_captured_on_not_null NOT NULL
);


--
-- Name: queue_stats_20261121; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue_stats_20261121 (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT queue_stats_id_not_null NOT NULL,
    name text CONSTRAINT queue_stats_name_not_null NOT NULL,
    deferred_count integer DEFAULT 0 CONSTRAINT queue_stats_deferred_count_not_null NOT NULL,
    queued_count integer DEFAULT 0 CONSTRAINT queue_stats_queued_count_not_null NOT NULL,
    ready_count integer DEFAULT 0 CONSTRAINT queue_stats_ready_count_not_null NOT NULL,
    active_count integer DEFAULT 0 CONSTRAINT queue_stats_active_count_not_null NOT NULL,
    failed_count integer DEFAULT 0 CONSTRAINT queue_stats_failed_count_not_null NOT NULL,
    total_count integer DEFAULT 0 CONSTRAINT queue_stats_total_count_not_null NOT NULL,
    created_delta integer,
    completed_delta integer,
    failed_delta integer,
    delta_seconds integer,
    delta_on timestamp with time zone,
    wait_bins integer[],
    run_bins integer[],
    ready_oldest_seconds integer,
    captured_on timestamp with time zone DEFAULT now() CONSTRAINT queue_stats_captured_on_not_null NOT NULL
);


--
-- Name: schedule; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.schedule (
    name text NOT NULL,
    key text DEFAULT ''::text NOT NULL,
    kind text DEFAULT 'cron'::text NOT NULL,
    cron text NOT NULL,
    timezone text DEFAULT 'UTC'::text,
    data jsonb,
    options jsonb,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL,
    last_job_id uuid,
    CONSTRAINT schedule_kind_check CHECK ((kind = ANY (ARRAY['cron'::text, 'rrule'::text])))
);


--
-- Name: subscription; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.subscription (
    event text NOT NULL,
    name text NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: version; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.version (
    version integer NOT NULL,
    cron_on timestamp with time zone,
    bam_on timestamp with time zone,
    flow_on timestamp with time zone,
    reindex_on timestamp with time zone,
    monitor_backoff_on timestamp with time zone
);


--
-- Name: warning; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.warning (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    message text NOT NULL,
    data jsonb,
    created_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    token_hash text NOT NULL,
    scopes text[] NOT NULL,
    installation_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason text,
    first_used_at timestamp with time zone,
    last_used_at timestamp with time zone,
    last_network_address inet,
    request_count bigint DEFAULT 0 NOT NULL,
    summarized_count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT agent_tokens_hash_only CHECK ((token_hash ~ '^[A-Za-z0-9_-]{43}$'::text)),
    CONSTRAINT agent_tokens_known_reason CHECK ((revoked_reason = ANY (ARRAY['revoked'::text, 'replaced'::text, 'agent-disabled'::text, 'member-removed'::text, 'member-left'::text, 'allowlist-removed'::text, 'signed-out-everywhere'::text]))),
    CONSTRAINT agent_tokens_known_scopes CHECK (((cardinality(scopes) > 0) AND (scopes <@ ARRAY['catalog:read'::text, 'catalog:propose'::text, 'tasks:read'::text, 'tasks:write'::text, 'presence'::text]))),
    CONSTRAINT agent_tokens_reason_when_revoked CHECK (((revoked_at IS NULL) = (revoked_reason IS NULL)))
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    member_id uuid NOT NULL,
    person_id uuid NOT NULL,
    coding_tool text NOT NULL,
    machine text NOT NULL,
    handle text NOT NULL,
    name text NOT NULL,
    machine_entity_id text,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    disabled_at timestamp with time zone,
    CONSTRAINT agents_coding_tool_format CHECK ((coding_tool ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT agents_disabled_at_when_disabled CHECK ((enabled = (disabled_at IS NULL))),
    CONSTRAINT agents_handle_from_tool_and_machine CHECK ((handle = ((coding_tool || '-'::text) || machine))),
    CONSTRAINT agents_machine_format CHECK ((machine ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT agents_name_not_blank CHECK ((btrim(name) <> ''::text))
);


--
-- Name: catalog_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    current_revision integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_index_discrepancies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_index_discrepancies (
    document_id uuid NOT NULL,
    key text NOT NULL,
    workspace_id uuid NOT NULL,
    parser_version integer NOT NULL,
    entity_id text NOT NULL,
    "values" jsonb NOT NULL,
    identities text[] NOT NULL,
    accepted boolean NOT NULL
);


--
-- Name: catalog_index_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_index_documents (
    document_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    revision integer NOT NULL,
    parser_version integer NOT NULL,
    kind text NOT NULL,
    catalog_id text,
    type text,
    title text,
    summary text,
    status text,
    owner text,
    replaced_by text,
    aliases text[] NOT NULL,
    imported_from text,
    decision_state text,
    decided_on text,
    decided_by text,
    missing_keys text[] NOT NULL,
    problems jsonb NOT NULL,
    data jsonb,
    search_text text NOT NULL,
    body text NOT NULL,
    search tsvector GENERATED ALWAYS AS ((((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(summary, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, search_text), 'C'::"char")) || setweight(to_tsvector('english'::regconfig, body), 'D'::"char"))) STORED NOT NULL,
    search_simple tsvector GENERATED ALWAYS AS ((((setweight(to_tsvector('simple'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(summary, ''::text)), 'B'::"char")) || setweight(to_tsvector('simple'::regconfig, search_text), 'C'::"char")) || setweight(to_tsvector('simple'::regconfig, body), 'D'::"char"))) STORED NOT NULL,
    rules_version integer DEFAULT 0 NOT NULL
);


--
-- Name: catalog_index_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_index_facts (
    document_id uuid NOT NULL,
    "position" integer NOT NULL,
    workspace_id uuid NOT NULL,
    parser_version integer NOT NULL,
    entity_id text NOT NULL,
    identity text NOT NULL,
    key text NOT NULL,
    state text NOT NULL,
    form text NOT NULL,
    value jsonb,
    "to" text,
    via text,
    note text,
    task text,
    remove boolean NOT NULL,
    accepted text,
    attributes jsonb NOT NULL,
    group_index integer NOT NULL,
    many boolean NOT NULL,
    relation boolean NOT NULL,
    in_schema boolean NOT NULL,
    recheck_days integer,
    has_check boolean NOT NULL,
    checked text,
    checked_at timestamp with time zone,
    by text,
    scope text,
    source text,
    limits text,
    due_at timestamp with time zone
);


--
-- Name: catalog_index_provenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_index_provenance (
    document_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    parser_version integer NOT NULL,
    authors jsonb NOT NULL,
    units bytea NOT NULL
);


--
-- Name: catalog_index_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_index_relations (
    document_id uuid NOT NULL,
    "position" integer NOT NULL,
    workspace_id uuid NOT NULL,
    parser_version integer NOT NULL,
    from_id text NOT NULL,
    from_type text,
    key text NOT NULL,
    to_id text NOT NULL,
    state text,
    identity text,
    attributes jsonb NOT NULL,
    inverse text,
    field boolean NOT NULL
);


--
-- Name: catalog_index_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_index_sections (
    document_id uuid NOT NULL,
    "position" integer NOT NULL,
    workspace_id uuid NOT NULL,
    parser_version integer NOT NULL,
    catalog_id text,
    heading text,
    level integer NOT NULL,
    anchor text,
    text text NOT NULL,
    start integer NOT NULL,
    "end" integer NOT NULL,
    changed_revision integer NOT NULL,
    author_kind public.actor_kind NOT NULL,
    author text NOT NULL,
    least_trusted_kind public.actor_kind NOT NULL,
    least_trusted text NOT NULL,
    search tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(heading, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, text), 'B'::"char"))) STORED NOT NULL,
    search_simple tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('simple'::regconfig, COALESCE(heading, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, text), 'B'::"char"))) STORED NOT NULL
);


--
-- Name: catalog_index_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_index_state (
    workspace_id uuid NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    parser_version integer NOT NULL,
    rebuild_requested_at timestamp with time zone,
    rebuilt_at timestamp with time zone,
    checked_at timestamp with time zone,
    checked_revision integer,
    check_differences integer,
    check_details jsonb,
    rules_version integer DEFAULT 0 NOT NULL
);


--
-- Name: catalog_page_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_page_visits (
    workspace_id uuid NOT NULL,
    person_id uuid NOT NULL,
    document_id uuid NOT NULL,
    revision integer NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_proposal_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_proposal_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_person_id uuid,
    actor_agent_id uuid,
    actor_agent_session_id uuid,
    actor_label text NOT NULL,
    confidence public.attribution_confidence NOT NULL,
    text text NOT NULL,
    idempotency_key text,
    CONSTRAINT catalog_proposal_comments_actor_known CHECK ((((actor_kind <> ALL (ARRAY['person'::public.actor_kind, 'agent'::public.actor_kind])) OR (actor_person_id IS NOT NULL)) AND ((actor_kind <> 'agent'::public.actor_kind) OR (actor_agent_id IS NOT NULL)))),
    CONSTRAINT catalog_proposal_comments_text_not_blank CHECK ((btrim(text) <> ''::text))
);


--
-- Name: catalog_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_person_id uuid,
    actor_agent_id uuid,
    actor_agent_session_id uuid,
    actor_label text NOT NULL,
    confidence public.attribution_confidence NOT NULL,
    explanation text NOT NULL,
    related_task text,
    operations jsonb NOT NULL,
    based_on_revision integer NOT NULL,
    state public.catalog_proposal_state DEFAULT 'pending'::public.catalog_proposal_state NOT NULL,
    approval_classes text[] NOT NULL,
    approval_reasons jsonb NOT NULL,
    touches text[] NOT NULL,
    validation jsonb NOT NULL,
    idempotency_key text,
    request_hash text NOT NULL,
    applied_revision integer,
    decided_at timestamp with time zone,
    decided_by_person_id uuid,
    decided_by_agent_id uuid,
    decided_by_label text,
    rejection_reason text,
    reverts_proposal_id uuid,
    CONSTRAINT catalog_proposals_actor_known CHECK ((((actor_kind <> ALL (ARRAY['person'::public.actor_kind, 'agent'::public.actor_kind])) OR (actor_person_id IS NOT NULL)) AND ((actor_kind <> 'agent'::public.actor_kind) OR (actor_agent_id IS NOT NULL)))),
    CONSTRAINT catalog_proposals_applied_revision CHECK (((state = 'applied'::public.catalog_proposal_state) = (applied_revision IS NOT NULL))),
    CONSTRAINT catalog_proposals_decided CHECK ((((state = 'pending'::public.catalog_proposal_state) = (decided_at IS NULL)) AND ((decided_at IS NULL) = (decided_by_label IS NULL)))),
    CONSTRAINT catalog_proposals_number_positive CHECK ((number > 0)),
    CONSTRAINT catalog_proposals_rejection_reason CHECK (((state = 'rejected'::public.catalog_proposal_state) = (rejection_reason IS NOT NULL)))
);


--
-- Name: catalog_purges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_purges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_person_id uuid,
    actor_agent_id uuid,
    actor_agent_session_id uuid,
    actor_label text NOT NULL,
    confidence public.attribution_confidence NOT NULL,
    reason text NOT NULL,
    counts jsonb NOT NULL,
    transaction_id xid8 DEFAULT pg_current_xact_id() NOT NULL,
    CONSTRAINT catalog_purges_actor_known CHECK ((((actor_kind <> ALL (ARRAY['person'::public.actor_kind, 'agent'::public.actor_kind])) OR (actor_person_id IS NOT NULL)) AND ((actor_kind <> 'agent'::public.actor_kind) OR (actor_agent_id IS NOT NULL)))),
    CONSTRAINT catalog_purges_number_positive CHECK ((number > 0))
);


--
-- Name: catalog_revision_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_revision_documents (
    workspace_id uuid NOT NULL,
    revision integer NOT NULL,
    document_id uuid NOT NULL,
    text text NOT NULL
);


--
-- Name: catalog_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_revisions (
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_person_id uuid,
    actor_agent_id uuid,
    actor_agent_session_id uuid,
    actor_label text NOT NULL,
    confidence public.attribution_confidence NOT NULL,
    proposal_id uuid,
    based_on_revision integer,
    approved_by_person_id uuid,
    approved_by_label text,
    purge_id uuid,
    CONSTRAINT catalog_revisions_actor_known CHECK ((((actor_kind <> ALL (ARRAY['person'::public.actor_kind, 'agent'::public.actor_kind])) OR (actor_person_id IS NOT NULL)) AND ((actor_kind <> 'agent'::public.actor_kind) OR (actor_agent_id IS NOT NULL)))),
    CONSTRAINT catalog_revisions_approver_labelled CHECK (((approved_by_person_id IS NULL) = (approved_by_label IS NULL))),
    CONSTRAINT catalog_revisions_number_positive CHECK ((number > 0)),
    CONSTRAINT catalog_revisions_one_source CHECK (((proposal_id IS NULL) OR (purge_id IS NULL)))
);


--
-- Name: email_allowlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_allowlist (
    email text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_allowlist_email_lower_case CHECK ((email = lower(email)))
);


--
-- Name: email_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_changes (
    person_id uuid NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_changes_email_lower_case CHECK ((email = lower(email)))
);


--
-- Name: email_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.email_kind NOT NULL,
    recipient text NOT NULL,
    network_address inet,
    status public.email_status DEFAULT 'queued'::public.email_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    provider_message_id text,
    not_after timestamp with time zone NOT NULL,
    message jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT email_deliveries_finished_unless_queued CHECK (((status = 'queued'::public.email_status) = (finished_at IS NULL))),
    CONSTRAINT email_deliveries_message_only_while_queued CHECK (((status = 'queued'::public.email_status) = (message IS NOT NULL))),
    CONSTRAINT email_deliveries_recipient_lower_case CHECK ((recipient = lower(recipient)))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    workspace_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text NOT NULL,
    origin public.event_origin NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_person_id uuid,
    actor_agent_id uuid,
    actor_agent_session_id uuid,
    actor_label text NOT NULL,
    confidence public.attribution_confidence NOT NULL,
    subjects jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    link text,
    idempotency_key text,
    CONSTRAINT events_actor_known CHECK ((((actor_kind <> ALL (ARRAY['person'::public.actor_kind, 'agent'::public.actor_kind])) OR (actor_person_id IS NOT NULL)) AND ((actor_kind <> 'agent'::public.actor_kind) OR (actor_agent_id IS NOT NULL))))
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: installation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installation (
    id smallint DEFAULT 1 NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    CONSTRAINT installation_single_row CHECK ((id = 1))
);


--
-- Name: installation_operators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installation_operators (
    email text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT installation_operators_email_lower_case CHECK ((email = lower(email)))
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    role public.role NOT NULL,
    state public.invitation_state DEFAULT 'pending'::public.invitation_state NOT NULL,
    token_hash text NOT NULL,
    invited_by_member_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    decided_at timestamp with time zone,
    member_id uuid,
    CONSTRAINT invitations_decided_unless_pending CHECK (((state = 'pending'::public.invitation_state) = (decided_at IS NULL))),
    CONSTRAINT invitations_email_lower_case CHECK ((email = lower(email))),
    CONSTRAINT invitations_member_when_accepted CHECK (((state = 'accepted'::public.invitation_state) = (member_id IS NOT NULL)))
);


--
-- Name: known_browsers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.known_browsers (
    person_id uuid NOT NULL,
    browser_hash text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    person_id uuid NOT NULL,
    role public.role NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    invited_by_member_id uuid,
    removed_at timestamp with time zone
);


--
-- Name: pending_github_sign_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_github_sign_ins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    github_account_id text NOT NULL,
    github_login text,
    email text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pending_github_sign_ins_email_lower_case CHECK ((email = lower(email)))
);


--
-- Name: people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    handle text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email_verified boolean DEFAULT true NOT NULL,
    image text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT people_email_lower_case CHECK ((email = lower(email))),
    CONSTRAINT people_handle_format CHECK ((handle ~ '^[a-z0-9-]+$'::text))
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE UNLOGGED TABLE public.rate_limits (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer NOT NULL
);


--
-- Name: security_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_log (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid,
    action text NOT NULL,
    outcome public.security_outcome NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_person_id uuid,
    actor_agent_id uuid,
    actor_agent_session_id uuid,
    actor_label text NOT NULL,
    confidence public.attribution_confidence NOT NULL,
    subject_person_id uuid,
    network_address inet,
    client text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT security_log_actor_known CHECK ((((actor_kind <> ALL (ARRAY['person'::public.actor_kind, 'agent'::public.actor_kind])) OR (actor_person_id IS NOT NULL)) AND ((actor_kind <> 'agent'::public.actor_kind) OR (actor_agent_id IS NOT NULL))))
);


--
-- Name: security_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.security_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.security_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: setup_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.setup_links (
    id smallint DEFAULT 1 NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT setup_links_email_lower_case CHECK ((email = lower(email))),
    CONSTRAINT setup_links_single_row CHECK ((id = 1))
);


--
-- Name: sign_in_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sign_in_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    provider_id text NOT NULL,
    account_id text NOT NULL,
    login text,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sign_in_accounts_github_only CHECK ((provider_id = 'github'::text)),
    CONSTRAINT sign_in_accounts_no_credentials CHECK (((access_token IS NULL) AND (refresh_token IS NULL) AND (id_token IS NULL) AND (password IS NULL)))
);


--
-- Name: sign_in_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sign_in_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    person_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text,
    user_agent text
);


--
-- Name: sign_in_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sign_in_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    catalog_strict boolean DEFAULT false NOT NULL,
    CONSTRAINT workspaces_name_not_blank CHECK ((btrim(name) <> ''::text))
);


--
-- Name: job_common; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.job_common DEFAULT;


--
-- Name: queue_stats_20261120; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue_stats ATTACH PARTITION pgboss.queue_stats_20261120 FOR VALUES FROM ('2026-11-20 00:00:00+00') TO ('2026-11-21 00:00:00+00');


--
-- Name: queue_stats_20261121; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue_stats ATTACH PARTITION pgboss.queue_stats_20261121 FOR VALUES FROM ('2026-11-21 00:00:00+00') TO ('2026-11-22 00:00:00+00');


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: -
--

INSERT INTO drizzle.__drizzle_migrations VALUES (1, '037e6529aabba21280f51f291ba8d518345a852e67ee66c9abf2255a67ca2462', 1794848507496);
INSERT INTO drizzle.__drizzle_migrations VALUES (2, '2d3a95504a4de11557d8f8a663f86f2a7440de65bec94e5e4703372365a1d380', 1794848514867);
INSERT INTO drizzle.__drizzle_migrations VALUES (3, 'ce1f9beabc7cd9352b9fcd153716f4f541415b1d0b3e7cc08051ec24725b205c', 1794851510813);
INSERT INTO drizzle.__drizzle_migrations VALUES (4, '180220460893559d495ef0c0cf0399e9ec2c2896b7975159fa5ed6c0aabad761', 1794855102377);
INSERT INTO drizzle.__drizzle_migrations VALUES (5, 'f2b69209b9d7e790a342d180cd0f7436dc9068eba17db0c3620d9ef8b54fbc09', 1794862489696);
INSERT INTO drizzle.__drizzle_migrations VALUES (6, '379445f1367a52b484108f3cfc2258bd2e88f2ada5aed1eae94d051538d59d78', 1794968097506);
INSERT INTO drizzle.__drizzle_migrations VALUES (7, '9be23e5eb5254b42224eb275b0fb99d4cd6e0ca4baf07219649d7ef85e284bb3', 1794983863103);
INSERT INTO drizzle.__drizzle_migrations VALUES (8, '5a14fdb754279c857b8e23f79192c20292eabfcc1d30753fa387a6c18bafacbe', 1794992490114);
INSERT INTO drizzle.__drizzle_migrations VALUES (9, 'ed66749a670cd598c9e40219d59d1366ab7cf0a1438814b429b1f050f0db015f', 1795008058242);
INSERT INTO drizzle.__drizzle_migrations VALUES (10, 'e8e3232e9d348586defb87a71c69fca735e446c8b612fc6e16238fc5c1b7f542', 1795017109399);
INSERT INTO drizzle.__drizzle_migrations VALUES (11, '5b35e8a61b060f879dd1f2ba0b41184de9b5e1bb2e02f952218369d9e46264bc', 1795025727689);
INSERT INTO drizzle.__drizzle_migrations VALUES (12, '3a79540667ee50b8c94f076d33c9fac36017ae5c72c368f3dd20dda940659433', 1795038460378);
INSERT INTO drizzle.__drizzle_migrations VALUES (13, '117ad872731c3f02e242cea10152765f8f693c06aa506c937f4472c1ac192bb8', 1795044042593);


--
-- Data for Name: bam; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: instance; Type: TABLE DATA; Schema: pgboss; Owner: -
--

INSERT INTO pgboss.instance VALUES ('d9b0e684-ea40-44b2-87f2-4900bd413d25', NULL, 'daedalus', 1321140, '12.38.2', 'v24.22.0', 'pgboss:d9b0e684', 30, false, false, true, false, false, 1, 1, 1, 0, '[]', '{"cpu": null, "rss": 236240896, "cgroup": 2, "cpuLimit": 2, "heapUsed": 57881456, "heapLimit": 4496293888, "loopDelay": null, "memoryUsed": null, "memoryLimit": 16744071168, "cpuThrottled": null, "loopDelayMax": null, "loopUtilization": null}', '{"max": 1, "adapter": "pg", "backend": "postgres", "migrate": true, "reindex": true, "schedule": false, "supervise": false, "createSchema": true, "useListenNotify": false, "bamIntervalSeconds": 60, "flowIntervalSeconds": 5, "warningRetentionDays": 365, "monitorIntervalSeconds": 60, "queueStatRetentionDays": 7, "reindexIntervalSeconds": 86400, "instanceHeartbeatSeconds": 30, "superviseIntervalSeconds": 60, "cronWorkerIntervalSeconds": 5, "queueCacheIntervalSeconds": 60, "cronMonitorIntervalSeconds": 30, "maintenanceIntervalSeconds": 86400, "clockMonitorIntervalSeconds": 600}', 0, NULL, '2026-11-20 17:06:33.718707+00', '2026-11-20 17:06:33.718707+00', '2026-11-20 17:06:33.745246+00');


--
-- Data for Name: job_common; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: job_dependency; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: queue; Type: TABLE DATA; Schema: pgboss; Owner: -
--

INSERT INTO pgboss.queue VALUES ('email', 'standard', 12, 30, true, 600, 60, 1209600, 604800, NULL, false, 'job_common', 0, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, 0, 0, 0, NULL, NULL, NULL, NULL, NULL, '{}', NULL, true, NULL, NULL, NULL, NULL, '2026-11-20 17:06:33.728938+00', '2026-11-20 17:06:33.733698+00');
INSERT INTO pgboss.queue VALUES ('catalog-index-rebuild', 'stately', 5, 60, true, NULL, 3600, 1209600, 604800, NULL, false, 'job_common', 0, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, 0, 0, 0, NULL, NULL, NULL, NULL, NULL, '{}', NULL, false, NULL, NULL, NULL, NULL, '2026-11-20 17:06:33.737423+00', '2026-11-20 17:06:33.740812+00');


--
-- Data for Name: queue_stats_20261120; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: queue_stats_20261121; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: schedule; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: subscription; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: version; Type: TABLE DATA; Schema: pgboss; Owner: -
--

INSERT INTO pgboss.version VALUES (46, NULL, '2026-11-20 17:06:33.711531+00', NULL, NULL, NULL);


--
-- Data for Name: warning; Type: TABLE DATA; Schema: pgboss; Owner: -
--



--
-- Data for Name: agent_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_tokens VALUES ('c1aaf9a6-0552-4dd7-9b2f-aa31a10bac69', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'af86e78a-52ed-479c-bf2f-078cd0e13275', '_M1B1qskSj08gXcPeRKZvsLo9aCFXs_5ukT2ZX-YODk', '{catalog:read,catalog:propose,tasks:read,tasks:write,presence}', 'https://localhost:18444', '2026-11-20 17:06:33.797963+00', NULL, NULL, NULL, NULL, NULL, 0, 0);
INSERT INTO public.agent_tokens VALUES ('3dd8e8eb-25c7-4db6-b61a-a7368be0c148', '245ec4ac-8126-443d-9bc5-8002458371c8', '5df27c69-9444-4b42-b2ab-a46c0201aaef', '1-WhC9xTa3LC2sCQfxihlvYHI_98BCSJxhL_hNh0-bI', '{catalog:read,catalog:propose,tasks:read,tasks:write,presence}', 'https://localhost:18444', '2026-11-20 17:06:34.996869+00', NULL, NULL, NULL, NULL, NULL, 0, 0);


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agents VALUES ('af86e78a-52ed-479c-bf2f-078cd0e13275', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'a781e967-4156-4ab0-ace2-65cf5f3006f2', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'opencode', 'daedalus', 'opencode-daedalus', 'opencode-daedalus', NULL, true, '2026-11-20 17:06:33.797963+00', NULL);
INSERT INTO public.agents VALUES ('5df27c69-9444-4b42-b2ab-a46c0201aaef', '245ec4ac-8126-443d-9bc5-8002458371c8', '6a441039-ac52-46b6-9e86-56c28d9f757f', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'opencode', 'daedalus', 'opencode-daedalus', 'opencode-daedalus', NULL, true, '2026-11-20 17:06:34.996869+00', NULL);


--
-- Data for Name: catalog_documents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_documents VALUES ('2d90b934-a419-42aa-9ed6-02d3b07e8773', '610d5273-74e3-4a7e-8a00-e96e141516a9', 1, '2026-11-20 17:06:34.087359+00');
INSERT INTO public.catalog_documents VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', '610d5273-74e3-4a7e-8a00-e96e141516a9', 2, '2026-11-20 17:06:34.154707+00');
INSERT INTO public.catalog_documents VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '2026-11-20 17:06:34.252372+00');
INSERT INTO public.catalog_documents VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', '610d5273-74e3-4a7e-8a00-e96e141516a9', 5, '2026-11-20 17:06:34.298606+00');
INSERT INTO public.catalog_documents VALUES ('818d0147-15e6-4104-8daf-6059de692de7', '610d5273-74e3-4a7e-8a00-e96e141516a9', 6, '2026-11-20 17:06:34.337911+00');
INSERT INTO public.catalog_documents VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', '610d5273-74e3-4a7e-8a00-e96e141516a9', 7, '2026-11-20 17:06:34.377812+00');
INSERT INTO public.catalog_documents VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', '610d5273-74e3-4a7e-8a00-e96e141516a9', 8, '2026-11-20 17:06:34.418574+00');
INSERT INTO public.catalog_documents VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', '610d5273-74e3-4a7e-8a00-e96e141516a9', 9, '2026-11-20 17:06:34.465522+00');
INSERT INTO public.catalog_documents VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', '610d5273-74e3-4a7e-8a00-e96e141516a9', 10, '2026-11-20 17:06:34.504025+00');
INSERT INTO public.catalog_documents VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', '610d5273-74e3-4a7e-8a00-e96e141516a9', 11, '2026-11-20 17:06:34.545684+00');
INSERT INTO public.catalog_documents VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', '610d5273-74e3-4a7e-8a00-e96e141516a9', 13, '2026-11-20 17:06:34.62234+00');
INSERT INTO public.catalog_documents VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', '610d5273-74e3-4a7e-8a00-e96e141516a9', 14, '2026-11-20 17:06:34.662892+00');
INSERT INTO public.catalog_documents VALUES ('29d82d55-cffc-4a03-ac03-c3e50b706dad', '610d5273-74e3-4a7e-8a00-e96e141516a9', 15, '2026-11-20 17:06:34.703256+00');
INSERT INTO public.catalog_documents VALUES ('802e1b36-b81c-4fcd-8794-35110cbaff61', '610d5273-74e3-4a7e-8a00-e96e141516a9', 17, '2026-11-20 17:06:34.789982+00');
INSERT INTO public.catalog_documents VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', '610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '2026-11-20 17:06:34.203038+00');
INSERT INTO public.catalog_documents VALUES ('588a7cbe-bcdb-472b-b47b-142e20cc4542', '610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '2026-11-20 17:06:34.750963+00');
INSERT INTO public.catalog_documents VALUES ('9c51187c-a872-4900-b208-e7447817f680', '610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '2026-11-20 17:06:34.583546+00');
INSERT INTO public.catalog_documents VALUES ('63b1a178-9000-4a1f-977f-21bb5461be59', '245ec4ac-8126-443d-9bc5-8002458371c8', 1, '2026-11-20 17:06:35.301174+00');
INSERT INTO public.catalog_documents VALUES ('2c447413-4811-4a6f-8c09-35a1ac47f6f0', '245ec4ac-8126-443d-9bc5-8002458371c8', 1, '2026-11-20 17:06:35.301174+00');
INSERT INTO public.catalog_documents VALUES ('cf423327-6773-4730-affd-5776fe6b5e3d', '245ec4ac-8126-443d-9bc5-8002458371c8', 2, '2026-11-20 17:06:35.357016+00');
INSERT INTO public.catalog_documents VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', '245ec4ac-8126-443d-9bc5-8002458371c8', 3, '2026-11-20 17:06:35.357016+00');
INSERT INTO public.catalog_documents VALUES ('4ece431f-1600-4c76-a839-f37d0a213110', '245ec4ac-8126-443d-9bc5-8002458371c8', 5, '2026-11-20 17:06:35.605158+00');
INSERT INTO public.catalog_documents VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', '245ec4ac-8126-443d-9bc5-8002458371c8', 7, '2026-11-20 17:06:35.357016+00');


--
-- Data for Name: catalog_index_discrepancies; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: catalog_index_documents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_index_documents VALUES ('2d90b934-a419-42aa-9ed6-02d3b07e8773', '610d5273-74e3-4a7e-8a00-e96e141516a9', 1, 4, 'entity', 'person/guneet', 'person', 'Guneet', 'Owner of the workspace''s projects, machines and services.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'person/guneet
person guneet
person
member
member
guneet', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', '610d5273-74e3-4a7e-8a00-e96e141516a9', 2, 4, 'entity', 'machine/musashi', 'machine', 'Musashi', 'A public-stacks machine for the dataset.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'machine/musashi
machine musashi
machine
role
role
public-stacks
environment
environment
production
access.method
access method
ssh
access.address
access address
203.0.113.10
platform.os
platform os
debian-13', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 4, 'entity', 'machine/daedalus', 'machine', 'Daedalus', 'A development machine for the dataset.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'machine/daedalus
machine daedalus
machine
role
role
development
environment
environment
production
access.method
access method
ssh
access.address
access address
203.0.113.12
platform.os
platform os
debian-13', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', '610d5273-74e3-4a7e-8a00-e96e141516a9', 5, 4, 'entity', 'service/obscuro', 'service', 'Secrets', 'Secrets, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/obscuro
service obscuro
service
endpoint
endpoint
https://secrets.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('818d0147-15e6-4104-8daf-6059de692de7', '610d5273-74e3-4a7e-8a00-e96e141516a9', 6, 4, 'entity', 'service/cloudflare-dns', 'service', 'DNS', 'DNS, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/cloudflare-dns
service cloudflare dns
service
endpoint
endpoint
https://dns.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', '610d5273-74e3-4a7e-8a00-e96e141516a9', 7, 4, 'entity', 'service/ingress', 'service', 'HTTPS ingress', 'HTTPS ingress, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/ingress
service ingress
service
endpoint
endpoint
https://ingress.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', '610d5273-74e3-4a7e-8a00-e96e141516a9', 8, 4, 'entity', 'service/forgejo', 'service', 'Git hosting', 'Git hosting, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/forgejo
service forgejo
service
endpoint
endpoint
https://git.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', '610d5273-74e3-4a7e-8a00-e96e141516a9', 9, 4, 'entity', 'service/monitoring', 'service', 'Monitoring', 'Monitoring, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/monitoring
service monitoring
service
endpoint
endpoint
https://monitor.example.com
environment
environment
production
runs-on
runs on
machine/anzen', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', '610d5273-74e3-4a7e-8a00-e96e141516a9', 10, 4, 'entity', 'service/email', 'service', 'Email', 'Email, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/email
service email
service
endpoint
endpoint
https://mail.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', '610d5273-74e3-4a7e-8a00-e96e141516a9', 11, 4, 'entity', 'service/shinan', 'service', 'Shinan', 'Shinan, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/shinan
service shinan
service
endpoint
endpoint
https://shinan.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', '610d5273-74e3-4a7e-8a00-e96e141516a9', 13, 4, 'entity', 'service/mon-public', 'service', 'Public board', 'Public board, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/mon-public
service mon public
service
endpoint
endpoint
https://status.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', '610d5273-74e3-4a7e-8a00-e96e141516a9', 14, 4, 'entity', 'service/easyshell', 'service', 'Shell lessons', 'Shell lessons, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/easyshell
service easyshell
service
endpoint
endpoint
https://shell.example.com
environment
environment
production
runs-on
runs on
machine/musashi', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('29d82d55-cffc-4a03-ac03-c3e50b706dad', '610d5273-74e3-4a7e-8a00-e96e141516a9', 15, 4, 'entity', 'project/shinan', 'project', 'Shinan', 'The Shinan project.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'project/shinan
project shinan
project
repository
repository
https://github.com/example/shinan', '
# Shinan

Notes kept by agents.
', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('802e1b36-b81c-4fcd-8794-35110cbaff61', '610d5273-74e3-4a7e-8a00-e96e141516a9', 17, 4, 'entity', 'project/easyshell', 'project', 'easyshell', 'The easyshell project.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'project/easyshell
project easyshell
project
repository
repository
https://github.com/example/easyshell', '
# easyshell

Notes kept by agents.
', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', '610d5273-74e3-4a7e-8a00-e96e141516a9', 18, 4, 'entity', 'machine/anzen', 'machine', 'Anzen', 'A storage machine for the dataset.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'machine/anzen
machine anzen
machine
role
role
storage
environment
environment
production
access.method
access method
ssh
access.address
access address
203.0.113.11
platform.os
platform os
debian-13', '# Anzen

The backup repository is paused.
', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('588a7cbe-bcdb-472b-b47b-142e20cc4542', '610d5273-74e3-4a7e-8a00-e96e141516a9', 18, 4, 'entity', 'project/mon', 'project', 'mon', 'The mon project.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'project/mon
project mon
project
repository
repository
https://github.com/example/mon', '# mon

Tiles for every check.
', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('9c51187c-a872-4900-b208-e7447817f680', '610d5273-74e3-4a7e-8a00-e96e141516a9', 18, 4, 'entity', 'service/mon-private', 'service', 'Private board', 'Private board, as the dataset has it.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'service/mon-private
service mon private
service
endpoint
endpoint
https://mon.example.com
environment
environment
production
runs-on
runs on
machine/anzen', '# Private board

Reachable on the private network only.
', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('63b1a178-9000-4a1f-977f-21bb5461be59', '245ec4ac-8126-443d-9bc5-8002458371c8', 1, 4, 'schema', 'schema/domain', 'domain', 'Domains', 'Internet domains the workspace holds.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', '{"schema": {"keys": [{"key": "expires", "many": false, "built_in": false, "relation": null, "recheck_days": 90}, {"key": "registrar", "many": false, "built_in": false, "relation": null, "recheck_days": null}], "type": "domain", "status": "active", "built_in": false, "document": "schema/domain", "extended": false, "required": ["registrar"], "sections": []}}', 'schema/domain
schema domain
domain', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('2c447413-4811-4a6f-8c09-35a1ac47f6f0', '245ec4ac-8126-443d-9bc5-8002458371c8', 1, 4, 'entity', 'person/guneet', 'person', 'Guneet', 'The owner.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'person/guneet
person guneet
person
member
member
guneet', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('cf423327-6773-4730-affd-5776fe6b5e3d', '245ec4ac-8126-443d-9bc5-8002458371c8', 2, 4, 'entity', 'domain/example-org', 'domain', 'example.org', 'A domain of the dataset.', 'active', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'domain/example-org
domain example org
domain
registrar
registrar
Example Registrar', '
# example.org

Renouvelé chaque année — 日本語のメモ — ✅
', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', '245ec4ac-8126-443d-9bc5-8002458371c8', 3, 4, 'entity', 'machine/old-box', 'machine', 'Old box', 'A retired-host machine for the dataset.', 'retired', 'person/guneet', NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'machine/old-box
machine old box
machine
role
role
retired-host
environment
environment
production
access.method
access method
ssh
access.address
access address
203.0.113.20
platform.os
platform os
debian-13', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('4ece431f-1600-4c76-a839-f37d0a213110', '245ec4ac-8126-443d-9bc5-8002458371c8', 5, 4, 'start-here', 'start-here', NULL, 'Start here', NULL, NULL, NULL, NULL, '{}', NULL, NULL, NULL, NULL, '{}', '[]', '{"agents": [{"list": "known-unknowns", "note": "What nobody knows yet."}], "people": [{"to": "machine/miyamoto", "note": "The build machine."}, {"list": "waiting-for-approval", "note": "What waits for a person."}]}', 'start-here
start here', '', DEFAULT, DEFAULT, 1);
INSERT INTO public.catalog_index_documents VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', '245ec4ac-8126-443d-9bc5-8002458371c8', 7, 4, 'entity', 'machine/miyamoto', 'machine', 'Kojiro', 'A build machine for the dataset.', 'active', 'person/guneet', NULL, '{machine/kojiro}', NULL, NULL, NULL, NULL, '{}', '[]', NULL, 'machine/miyamoto
machine miyamoto
machine/kojiro
machine kojiro
machine
role
role
build
environment
environment
production
access.method
access method
ssh
access.address
access address
203.0.113.21
platform.os
platform os
debian-13', '# Miyamoto

The spare key is kept (purged).
', DEFAULT, DEFAULT, 1);


--
-- Data for Name: catalog_index_facts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_index_facts VALUES ('2d90b934-a419-42aa-9ed6-02d3b07e8773', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'person/guneet', 'member|observed', 'member', 'observed', 'short', '["guneet"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, NULL, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Membership', 'Shinan''s member list', NULL, NULL);
INSERT INTO public.catalog_index_facts VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/musashi', 'role|observed', 'role', 'observed', 'short', '["public-stacks"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read role', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/musashi', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/musashi', 'access.method|observed', 'access.method', 'observed', 'short', '["ssh"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 2, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.method', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', 3, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/musashi', 'access.address|observed', 'access.address', 'observed', 'short', '["203.0.113.10"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 3, false, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.address', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', 4, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/musashi', 'platform.os|observed', 'platform.os', 'observed', 'short', '["debian-13"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 4, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read platform.os', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/daedalus', 'role|observed', 'role', 'observed', 'short', '["development"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read role', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/daedalus', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/daedalus', 'access.method|observed', 'access.method', 'observed', 'short', '["ssh"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 2, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.method', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', 3, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/daedalus', 'access.address|observed', 'access.address', 'observed', 'short', '["203.0.113.12"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 3, false, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.address', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', 4, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/daedalus', 'platform.os|observed', 'platform.os', 'observed', 'short', '["debian-13"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 4, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read platform.os', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/obscuro', 'endpoint|observed|value=https://secrets.example.com', 'endpoint', 'observed', 'short', '["https://secrets.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/obscuro', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/obscuro', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('818d0147-15e6-4104-8daf-6059de692de7', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/cloudflare-dns', 'endpoint|observed|value=https://dns.example.com', 'endpoint', 'observed', 'short', '["https://dns.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('818d0147-15e6-4104-8daf-6059de692de7', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/cloudflare-dns', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('818d0147-15e6-4104-8daf-6059de692de7', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/cloudflare-dns', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/ingress', 'endpoint|observed|value=https://ingress.example.com', 'endpoint', 'observed', 'short', '["https://ingress.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/ingress', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/ingress', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/forgejo', 'endpoint|observed|value=https://git.example.com', 'endpoint', 'observed', 'short', '["https://git.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/forgejo', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/forgejo', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/monitoring', 'endpoint|observed|value=https://monitor.example.com', 'endpoint', 'observed', 'short', '["https://monitor.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/monitoring', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/monitoring', 'runs-on|observed|to=machine/anzen', 'runs-on', 'observed', 'short', NULL, 'machine/anzen', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/email', 'endpoint|observed|value=https://mail.example.com', 'endpoint', 'observed', 'short', '["https://mail.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/email', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/email', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/shinan', 'endpoint|observed|value=https://shinan.example.com', 'endpoint', 'observed', 'short', '["https://shinan.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/shinan', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/shinan', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-public', 'endpoint|observed|value=https://status.example.com', 'endpoint', 'observed', 'short', '["https://status.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-public', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-public', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/easyshell', 'endpoint|observed|value=https://shell.example.com', 'endpoint', 'observed', 'short', '["https://shell.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/easyshell', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/easyshell', 'runs-on|observed|to=machine/musashi', 'runs-on', 'observed', 'short', NULL, 'machine/musashi', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('29d82d55-cffc-4a03-ac03-c3e50b706dad', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/shinan', 'repository|observed|value=https://github.com/example/shinan', 'repository', 'observed', 'short', '["https://github.com/example/shinan"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read the remote', 'git remote -v', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('802e1b36-b81c-4fcd-8794-35110cbaff61', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/easyshell', 'repository|observed|value=https://github.com/example/easyshell', 'repository', 'observed', 'short', '["https://github.com/example/easyshell"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read the remote', 'git remote -v', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/anzen', 'role|observed', 'role', 'observed', 'short', '["storage"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read role', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/anzen', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/anzen', 'access.method|observed', 'access.method', 'observed', 'short', '["ssh"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 2, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.method', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', 3, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/anzen', 'access.address|observed', 'access.address', 'observed', 'short', '["203.0.113.11"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 3, false, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.address', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', 4, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/anzen', 'platform.os|observed', 'platform.os', 'observed', 'short', '["debian-13"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 4, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read platform.os', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('588a7cbe-bcdb-472b-b47b-142e20cc4542', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/mon', 'repository|observed|value=https://github.com/example/mon', 'repository', 'observed', 'short', '["https://github.com/example/mon"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read the remote', 'git remote -v', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('9c51187c-a872-4900-b208-e7447817f680', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-private', 'endpoint|observed|value=https://mon.example.com', 'endpoint', 'observed', 'short', '["https://mon.example.com"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, true, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Opened the endpoint', 'curl -I', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('9c51187c-a872-4900-b208-e7447817f680', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-private', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('9c51187c-a872-4900-b208-e7447817f680', 2, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-private', 'runs-on|observed|to=machine/anzen', 'runs-on', 'observed', 'short', NULL, 'machine/anzen', NULL, NULL, NULL, false, NULL, '{}', 2, true, true, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read runs-on', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('2c447413-4811-4a6f-8c09-35a1ac47f6f0', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'person/guneet', 'member|observed', 'member', 'observed', 'short', '["guneet"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, NULL, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Membership', 'Shinan''s member list', NULL, NULL);
INSERT INTO public.catalog_index_facts VALUES ('cf423327-6773-4730-affd-5776fe6b5e3d', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'domain/example-org', 'registrar|observed', 'registrar', 'observed', 'short', '["Example Registrar"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, NULL, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read WHOIS', 'whois', NULL, NULL);
INSERT INTO public.catalog_index_facts VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/old-box', 'role|observed', 'role', 'observed', 'short', '["retired-host"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read role', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', 1, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/old-box', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', 2, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/old-box', 'access.method|observed', 'access.method', 'observed', 'short', '["ssh"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 2, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.method', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', 3, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/old-box', 'access.address|observed', 'access.address', 'observed', 'short', '["203.0.113.20"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 3, false, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.address', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', 4, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/old-box', 'platform.os|observed', 'platform.os', 'observed', 'short', '["debian-13"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 4, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read platform.os', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/miyamoto', 'role|observed', 'role', 'observed', 'short', '["build"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 0, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read role', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', 1, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/miyamoto', 'environment|observed', 'environment', 'observed', 'short', '["production"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 1, false, false, true, 180, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read environment', 'The host', NULL, '2027-05-18 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', 2, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/miyamoto', 'access.method|observed', 'access.method', 'observed', 'short', '["ssh"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 2, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.method', 'The host', NULL, '2027-02-17 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', 3, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/miyamoto', 'access.address|observed', 'access.address', 'observed', 'short', '["203.0.113.21"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 3, false, false, true, 30, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read access.address', 'The host', NULL, '2026-12-19 06:40:00+00');
INSERT INTO public.catalog_index_facts VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', 4, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/miyamoto', 'platform.os|observed', 'platform.os', 'observed', 'short', '["debian-13"]', NULL, NULL, NULL, NULL, false, NULL, '{}', 4, false, false, true, 90, true, '2026-11-19T06:40:00Z', '2026-11-19 06:40:00+00', 'guneet via opencode-daedalus', 'Read platform.os', 'The host', NULL, '2027-02-17 06:40:00+00');


--
-- Data for Name: catalog_index_provenance; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_index_provenance VALUES ('2d90b934-a419-42aa-9ed6-02d3b07e8773', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('818d0147-15e6-4104-8daf-6059de692de7', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('29d82d55-cffc-4a03-ac03-c3e50b706dad', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[{"kind": "agent", "author": "guneet via opencode-daedalus"}]', '\x000877e24d81ac7500000010700729682ec20000');
INSERT INTO public.catalog_index_provenance VALUES ('802e1b36-b81c-4fcd-8794-35110cbaff61', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[{"kind": "agent", "author": "guneet via opencode-daedalus"}]', '\x000877e24d81ac7500000010700729682ec20000');
INSERT INTO public.catalog_index_provenance VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[{"kind": "agent", "author": "guneet via opencode-daedalus"}]', '\x00098adaad74a7ce0000001134065140a7de000000161d8258c481c00000');
INSERT INTO public.catalog_index_provenance VALUES ('588a7cbe-bcdb-472b-b47b-142e20cc4542', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[{"kind": "agent", "author": "guneet via opencode-daedalus"}]', '\x00047c823a6e64ff0000000877e24d81ac750000000dcf25431f897800000010700729682ec20000');
INSERT INTO public.catalog_index_provenance VALUES ('9c51187c-a872-4900-b208-e7447817f680', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '[{"kind": "agent", "author": "guneet via opencode-daedalus"}]', '\x00027b716f2cb2d00000000b4431e18258940000000f0043290557c4000000112237a5463dfc0000');
INSERT INTO public.catalog_index_provenance VALUES ('63b1a178-9000-4a1f-977f-21bb5461be59', '245ec4ac-8126-443d-9bc5-8002458371c8', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('2c447413-4811-4a6f-8c09-35a1ac47f6f0', '245ec4ac-8126-443d-9bc5-8002458371c8', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('cf423327-6773-4730-affd-5776fe6b5e3d', '245ec4ac-8126-443d-9bc5-8002458371c8', 4, '[{"kind": "agent", "author": "guneet via opencode-daedalus"}]', '\x000f4a391b51bf67000000198b3d75f845230000');
INSERT INTO public.catalog_index_provenance VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', '245ec4ac-8126-443d-9bc5-8002458371c8', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('4ece431f-1600-4c76-a839-f37d0a213110', '245ec4ac-8126-443d-9bc5-8002458371c8', 4, '[]', '\x');
INSERT INTO public.catalog_index_provenance VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', '245ec4ac-8126-443d-9bc5-8002458371c8', 4, '[{"kind": "agent", "author": "guneet via opencode-daedalus"}]', '\x0009f6b77618cc280000000c7c5682235dd60000001c82ce5ef004250000001f6dc52759cc290000');


--
-- Data for Name: catalog_index_relations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_index_relations VALUES ('2d90b934-a419-42aa-9ed6-02d3b07e8773', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'person/guneet', 'person', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/musashi', 'machine', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/daedalus', 'machine', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/obscuro', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/obscuro', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('818d0147-15e6-4104-8daf-6059de692de7', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/cloudflare-dns', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('818d0147-15e6-4104-8daf-6059de692de7', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/cloudflare-dns', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/ingress', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/ingress', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/forgejo', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/forgejo', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/monitoring', 'service', 'runs-on', 'machine/anzen', 'observed', 'runs-on|observed|to=machine/anzen', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/monitoring', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/email', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/email', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/shinan', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/shinan', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-public', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-public', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/easyshell', 'service', 'runs-on', 'machine/musashi', 'observed', 'runs-on|observed|to=machine/musashi', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/easyshell', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('29d82d55-cffc-4a03-ac03-c3e50b706dad', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/shinan', 'project', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('802e1b36-b81c-4fcd-8794-35110cbaff61', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/easyshell', 'project', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/anzen', 'machine', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('588a7cbe-bcdb-472b-b47b-142e20cc4542', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/mon', 'project', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('9c51187c-a872-4900-b208-e7447817f680', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-private', 'service', 'runs-on', 'machine/anzen', 'observed', 'runs-on|observed|to=machine/anzen', '{}', 'services', false);
INSERT INTO public.catalog_index_relations VALUES ('9c51187c-a872-4900-b208-e7447817f680', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-private', 'service', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('2c447413-4811-4a6f-8c09-35a1ac47f6f0', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'person/guneet', 'person', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('cf423327-6773-4730-affd-5776fe6b5e3d', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'domain/example-org', 'domain', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/old-box', 'machine', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);
INSERT INTO public.catalog_index_relations VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/miyamoto', 'machine', 'owner', 'person/guneet', NULL, NULL, '{}', 'owns', true);


--
-- Data for Name: catalog_index_sections; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_index_sections VALUES ('2d90b934-a419-42aa-9ed6-02d3b07e8773', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'person/guneet', NULL, 0, NULL, '', 324, 324, 1, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('dd67c540-6f25-47fc-8632-df08f4341bec', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/musashi', NULL, 0, NULL, '', 963, 963, 2, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('0bab91bc-46ae-4461-a8dd-85e06e81ec4f', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/daedalus', NULL, 0, NULL, '', 961, 961, 4, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('d42c4d57-afe6-4122-8f58-3deffbec28de', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/obscuro', NULL, 0, NULL, '', 646, 646, 5, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('818d0147-15e6-4104-8daf-6059de692de7', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/cloudflare-dns', NULL, 0, NULL, '', 641, 641, 6, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('c10052c8-58dc-45c5-a29b-7ba26255eb2e', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/ingress', NULL, 0, NULL, '', 658, 658, 7, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('66169daa-cec0-4afa-b241-e5d874f3202c', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/forgejo', NULL, 0, NULL, '', 650, 650, 8, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('80b9c107-ba5d-468a-90f2-79b600ebeae5', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/monitoring', NULL, 0, NULL, '', 653, 653, 9, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('260488e2-10c5-42e3-a773-51b84b78256d', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/email', NULL, 0, NULL, '', 637, 637, 10, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('6c7c0d83-e4d7-4faa-bf01-a234de5dd921', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/shinan', NULL, 0, NULL, '', 642, 642, 11, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('790ef0b6-3445-4e46-844c-9c54e3a349df', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-public', NULL, 0, NULL, '', 658, 658, 13, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('39a426f8-e640-4c65-8f39-2a9ff08ca72c', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/easyshell', NULL, 0, NULL, '', 658, 658, 14, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('29d82d55-cffc-4a03-ac03-c3e50b706dad', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/shinan', NULL, 0, NULL, '
', 317, 318, 15, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('29d82d55-cffc-4a03-ac03-c3e50b706dad', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/shinan', 'Shinan', 1, 'shinan', '# Shinan

Notes kept by agents.
', 318, 350, 15, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('802e1b36-b81c-4fcd-8794-35110cbaff61', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/easyshell', NULL, 0, NULL, '
', 329, 330, 17, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('802e1b36-b81c-4fcd-8794-35110cbaff61', 1, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/easyshell', 'easyshell', 1, 'easyshell', '# easyshell

Notes kept by agents.
', 330, 365, 17, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('07748f43-2077-4140-a219-5329f1ece4cd', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'machine/anzen', 'Anzen', 1, 'anzen', '# Anzen

The backup repository is paused.
', 947, 989, 18, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('588a7cbe-bcdb-472b-b47b-142e20cc4542', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'project/mon', 'mon', 1, 'mon', '# mon

Tiles for every check.
', 305, 335, 18, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('9c51187c-a872-4900-b208-e7447817f680', 0, '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, 'service/mon-private', 'Private board', 1, 'private-board', '# Private board

Reachable on the private network only.
', 656, 712, 18, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('63b1a178-9000-4a1f-977f-21bb5461be59', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'schema/domain', NULL, 0, NULL, '', 196, 196, 1, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('2c447413-4811-4a6f-8c09-35a1ac47f6f0', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'person/guneet', NULL, 0, NULL, '', 277, 277, 1, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('cf423327-6773-4730-affd-5776fe6b5e3d', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'domain/example-org', NULL, 0, NULL, '
', 300, 301, 2, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('cf423327-6773-4730-affd-5776fe6b5e3d', 1, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'domain/example-org', 'example.org', 1, 'exampleorg', '# example.org

Renouvelé chaque année — 日本語のメモ — ✅
', 301, 352, 2, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('deb52502-50e4-4e3e-b676-c5a4718f7853', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/old-box', NULL, 0, NULL, '', 962, 962, 2, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('4ece431f-1600-4c76-a839-f37d0a213110', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'start-here', NULL, 0, NULL, '', 235, 235, 5, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);
INSERT INTO public.catalog_index_sections VALUES ('b346458d-2ea5-4dd2-9895-28011f1cb000', 0, '245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'machine/miyamoto', 'Miyamoto', 1, 'miyamoto', '# Miyamoto

The spare key is kept (purged).
', 973, 1017, 6, 'agent', 'guneet via opencode-daedalus', 'agent', 'guneet via opencode-daedalus', DEFAULT, DEFAULT);


--
-- Data for Name: catalog_index_state; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_index_state VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 18, 4, NULL, NULL, NULL, NULL, NULL, NULL, 1);
INSERT INTO public.catalog_index_state VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 7, 4, NULL, NULL, NULL, NULL, NULL, NULL, 1);


--
-- Data for Name: catalog_page_visits; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_page_visits VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'b346458d-2ea5-4dd2-9895-28011f1cb000', 4, '2026-11-20 17:06:35.710778+00');


--
-- Data for Name: catalog_proposal_comments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_proposal_comments VALUES ('5c444cc7-a3c7-4627-9611-8cc4af96f87b', '245ec4ac-8126-443d-9bc5-8002458371c8', '1bc8cf46-7c66-488c-b30f-94edc6fd02a5', '2026-11-20 17:06:35.686004+00', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', 'We still hold this domain.', NULL);


--
-- Data for Name: catalog_proposals; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_proposals VALUES ('14ded99c-0ae4-4343-bd3b-b78acf32ce40', '610d5273-74e3-4a7e-8a00-e96e141516a9', 1, '2026-11-20 17:06:34.059644+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "person/guneet", "op": "create-entity", "facts": [{"fact": {"key": "member", "state": "observed", "value": "guneet"}, "check": {"scope": "Membership", "source": "Shinan''s member list", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Guneet", "summary": "Owner of the workspace''s projects, machines and services."}]', 0, 'applied', '{observed-or-unknown,body-and-bookkeeping,people-and-agents}', '["Changes the person entity person/guneet"]', '{person/guneet}', '[]', 'dataset-1', 'eK55ZWnPnHkJq45Tzm4SZWKhbimv3-O21egHBbLQTws', 1, '2026-11-20 17:06:34.114+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, 'guneet', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('29c24392-5000-4b44-a069-7d480582173b', '610d5273-74e3-4a7e-8a00-e96e141516a9', 2, '2026-11-20 17:06:34.154707+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "machine/musashi", "op": "create-entity", "facts": [{"fact": {"key": "role", "state": "observed", "value": "public-stacks"}, "check": {"scope": "Read role", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.method", "state": "observed", "value": "ssh"}, "check": {"scope": "Read access.method", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.address", "state": "observed", "value": "203.0.113.10"}, "check": {"scope": "Read access.address", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "platform.os", "state": "observed", "value": "debian-13"}, "check": {"scope": "Read platform.os", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Musashi", "summary": "A public-stacks machine for the dataset."}]', 1, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{machine/musashi}', '[]', 'dataset-2', 'jFrvqOHsAULUa5WFR4hlnSULY3I5mGCQPxPjV8DqYLQ', 2, '2026-11-20 17:06:34.173+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('a61320f3-9d28-483b-939c-d323980eb87c', '610d5273-74e3-4a7e-8a00-e96e141516a9', 3, '2026-11-20 17:06:34.203038+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "machine/anzen", "op": "create-entity", "facts": [{"fact": {"key": "role", "state": "observed", "value": "storage"}, "check": {"scope": "Read role", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.method", "state": "observed", "value": "ssh"}, "check": {"scope": "Read access.method", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.address", "state": "observed", "value": "203.0.113.11"}, "check": {"scope": "Read access.address", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "platform.os", "state": "observed", "value": "debian-13"}, "check": {"scope": "Read platform.os", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Anzen", "summary": "A storage machine for the dataset."}]', 2, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{machine/anzen}', '[]', 'dataset-3', 'd9W0PJWuNXsdNel1MzocAuoy77AAyT8nIP72Ve8C214', 3, '2026-11-20 17:06:34.222+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('8b540c00-8214-4c55-b77d-3eaa9d4e1403', '610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '2026-11-20 17:06:34.252372+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "machine/daedalus", "op": "create-entity", "facts": [{"fact": {"key": "role", "state": "observed", "value": "development"}, "check": {"scope": "Read role", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.method", "state": "observed", "value": "ssh"}, "check": {"scope": "Read access.method", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.address", "state": "observed", "value": "203.0.113.12"}, "check": {"scope": "Read access.address", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "platform.os", "state": "observed", "value": "debian-13"}, "check": {"scope": "Read platform.os", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Daedalus", "summary": "A development machine for the dataset."}]', 3, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{machine/daedalus}', '[]', 'dataset-4', 'a3nDkzxgu4BPDy32bQsJtKZp8J5hNS1E8obIEMRVDWc', 4, '2026-11-20 17:06:34.276+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('10cfa0c6-c5b2-44de-90a9-9c60e62fe00a', '610d5273-74e3-4a7e-8a00-e96e141516a9', 5, '2026-11-20 17:06:34.298606+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/obscuro", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://secrets.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Secrets", "summary": "Secrets, as the dataset has it."}]', 4, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/obscuro}', '[]', 'dataset-5', 'd9GVe0KN0qsajRr2gfOFGN9HtDpz62egoHpkGYAB3NM', 5, '2026-11-20 17:06:34.315+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('4009aa1d-9868-4e51-aab4-c0251f031f06', '610d5273-74e3-4a7e-8a00-e96e141516a9', 6, '2026-11-20 17:06:34.337911+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/cloudflare-dns", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://dns.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "DNS", "summary": "DNS, as the dataset has it."}]', 5, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/cloudflare-dns}', '[]', 'dataset-6', 'Pq23AtDn6VzTAOHPnmrNC1p5ZnuKnHXwIGkrWTPCfZ8', 6, '2026-11-20 17:06:34.354+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('1c0966cc-3094-4d62-80f0-a28c3202fd62', '610d5273-74e3-4a7e-8a00-e96e141516a9', 7, '2026-11-20 17:06:34.377812+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/ingress", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://ingress.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "HTTPS ingress", "summary": "HTTPS ingress, as the dataset has it."}]', 6, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/ingress}', '[]', 'dataset-7', 'BaygsOeILYoj_FfbRX4-WF3QzzAWXjLtDDlpjxJeXp4', 7, '2026-11-20 17:06:34.394+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('76e2af9b-10db-4364-8a00-28c82c82770d', '610d5273-74e3-4a7e-8a00-e96e141516a9', 8, '2026-11-20 17:06:34.418574+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/forgejo", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://git.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Git hosting", "summary": "Git hosting, as the dataset has it."}]', 7, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/forgejo}', '[]', 'dataset-8', 'C5wJV7UsRpJUFvU3Rad8rC55TmzbDrdSNEXqk4gBEcI', 8, '2026-11-20 17:06:34.438+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('119fdba7-e7b0-434b-bdd4-d8ebfa89823e', '610d5273-74e3-4a7e-8a00-e96e141516a9', 9, '2026-11-20 17:06:34.465522+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/monitoring", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://monitor.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/anzen", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Monitoring", "summary": "Monitoring, as the dataset has it."}]', 8, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/monitoring}', '[]', 'dataset-9', 'ySQf5FQcgUHLaA2yAnonjDyoxwfm0HqI_zq7PxXcBDQ', 9, '2026-11-20 17:06:34.481+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('cfb95955-e8e7-4510-a1fe-892b13917367', '610d5273-74e3-4a7e-8a00-e96e141516a9', 10, '2026-11-20 17:06:34.504025+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/email", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://mail.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Email", "summary": "Email, as the dataset has it."}]', 9, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/email}', '[]', 'dataset-10', 'KEcvGh7Xr29NtRQ7me3RyVoAyd8_ayfMl9UEsES28ZY', 10, '2026-11-20 17:06:34.523+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('112f5fc8-6ff2-4144-9fb4-9dcb445e1ca0', '610d5273-74e3-4a7e-8a00-e96e141516a9', 11, '2026-11-20 17:06:34.545684+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/shinan", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://shinan.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Shinan", "summary": "Shinan, as the dataset has it."}]', 10, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/shinan}', '[]', 'dataset-11', 'cNEymaP0bHMOOcwSCQI8VFziyXwY-WJTdQdhRd60tik', 11, '2026-11-20 17:06:34.561+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('860d0050-d8a1-43ad-a2f9-4111e95a9ac4', '610d5273-74e3-4a7e-8a00-e96e141516a9', 12, '2026-11-20 17:06:34.583546+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/mon-private", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://mon.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/anzen", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Private board", "summary": "Private board, as the dataset has it."}]', 11, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/mon-private}', '[]', 'dataset-12', '6j470vvbdUc3g9dYsVTRJW0fd8ntlA1uIH61sSqTBXM', 12, '2026-11-20 17:06:34.599+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('d538824c-e85b-43e2-a816-79c92bdb9850', '610d5273-74e3-4a7e-8a00-e96e141516a9', 13, '2026-11-20 17:06:34.62234+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/mon-public", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://status.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Public board", "summary": "Public board, as the dataset has it."}]', 12, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/mon-public}', '[]', 'dataset-13', 'hIsuej_asSIfjSWZnRovwj2kvQ_aKZIonOpDxx0mmm0', 13, '2026-11-20 17:06:34.64+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('dbed0c0d-3dab-472d-b296-6b7369bd1f93', '610d5273-74e3-4a7e-8a00-e96e141516a9', 14, '2026-11-20 17:06:34.662892+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/easyshell", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://shell.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Shell lessons", "summary": "Shell lessons, as the dataset has it."}]', 13, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{service/easyshell}', '[]', 'dataset-14', '0SyOIyae7hzeuxET-ld4vQtQmMr40mVg5VbcK_k_Avo', 14, '2026-11-20 17:06:34.678+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('7cc7ac89-2218-42cf-a504-d89ea23c8e2e', '610d5273-74e3-4a7e-8a00-e96e141516a9', 15, '2026-11-20 17:06:34.703256+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "project/shinan", "op": "create-entity", "body": "# Shinan\n\nNotes kept by agents.\n", "facts": [{"fact": {"key": "repository", "state": "observed", "value": "https://github.com/example/shinan"}, "check": {"scope": "Read the remote", "source": "git remote -v", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Shinan", "summary": "The Shinan project."}]', 14, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{project/shinan}', '[]', 'dataset-15', '-CurIvjIuK8oKmj07VNdVBMjM7B0XIfSGvhxDyNtLTw', 15, '2026-11-20 17:06:34.721+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('c6b4c972-ef12-4033-9efb-79a1dda8d141', '610d5273-74e3-4a7e-8a00-e96e141516a9', 16, '2026-11-20 17:06:34.750963+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "project/mon", "op": "create-entity", "body": "# mon\n\nNotes kept by agents.\n", "facts": [{"fact": {"key": "repository", "state": "observed", "value": "https://github.com/example/mon"}, "check": {"scope": "Read the remote", "source": "git remote -v", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "mon", "summary": "The mon project."}]', 15, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{project/mon}', '[]', 'dataset-16', 'QTNl1kOQdsLjwpImfpeR3gFuuv8j6P55hEGEboh08jc', 16, '2026-11-20 17:06:34.767+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('000c3ea3-b98c-4bd7-aea6-5b59e83eb970', '610d5273-74e3-4a7e-8a00-e96e141516a9', 17, '2026-11-20 17:06:34.789982+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "project/easyshell", "op": "create-entity", "body": "# easyshell\n\nNotes kept by agents.\n", "facts": [{"fact": {"key": "repository", "state": "observed", "value": "https://github.com/example/easyshell"}, "check": {"scope": "Read the remote", "source": "git remote -v", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "easyshell", "summary": "The easyshell project."}]', 16, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{project/easyshell}', '[]', 'dataset-17', 'nxCFPyZdIwDvoG-Eao61vpYOTOjbbzEsVbN0zsAOeqM', 17, '2026-11-20 17:06:34.826+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('9dc831ce-be7e-46eb-9628-5775e6873a14', '610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '2026-11-20 17:06:34.88727+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"op": "edit-body", "text": "# Anzen\n\nThe backup repository is paused.\n", "expect": {"text": ""}, "document": "machine/anzen"}, {"op": "edit-body", "text": "# mon\n\nTiles for every check.\n", "expect": {"text": "\n# mon\n\nNotes kept by agents.\n"}, "document": "project/mon"}, {"op": "edit-body", "text": "# Private board\n\nReachable on the private network only.\n", "expect": {"text": ""}, "document": "service/mon-private"}]', 17, 'applied', '{body-and-bookkeeping}', '[]', '{machine/anzen,project/mon,service/mon-private}', '[]', 'dataset-18', 'KJyIxxGh3gBNsWZZN6xgq8BVFXTbqEAAPKMVB5-MozY', 18, '2026-11-20 17:06:34.91+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('fbc7e46a-15af-4c5b-8df7-5fe78ce1ca53', '610d5273-74e3-4a7e-8a00-e96e141516a9', 19, '2026-11-20 17:06:34.942201+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "service/container-registry", "op": "create-entity", "facts": [{"fact": {"key": "endpoint", "state": "observed", "value": "https://registry.example.com"}, "check": {"scope": "Opened the endpoint", "source": "curl -I", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"to": "machine/musashi", "key": "runs-on", "state": "observed"}, "check": {"scope": "Read runs-on", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Container registry", "summary": "Container registry, as the dataset has it."}]', 18, 'pending', '{observed-or-unknown,body-and-bookkeeping}', '["The workspace''s strict setting is on: every change except a recheck needs catalog approval"]', '{service/container-registry}', '[]', 'dataset-19', 'n6qkJFsJ8ei5hMZT531nPcI5ZwW5qCP5hWjv_i8-hew', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('ddd0c956-a5de-4ce9-9a4f-4355e5aa2957', '610d5273-74e3-4a7e-8a00-e96e141516a9', 20, '2026-11-20 17:06:34.965293+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"op": "create-start-here", "title": "Start here", "agents": [{"list": "due-for-recheck", "note": "Recheck these first."}, {"url": "https://example.com/workspace", "note": "Policies."}], "people": [{"to": "machine/musashi", "note": "Where the public stacks run."}, {"list": "waiting-for-approval", "note": "What waits for a person."}]}]', 18, 'pending', '{rules}', '["Changes the start-here document"]', '{start-here}', '[]', 'dataset-20', 'N3yVd07GmJe8AYZQB6IbvEBGdfiTijGb_CRxkkR6NmI', NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('1661ef56-0cd1-4338-8820-610c6b5792fc', '245ec4ac-8126-443d-9bc5-8002458371c8', 1, '2026-11-20 17:06:35.279461+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "person/guneet", "op": "create-entity", "facts": [{"fact": {"key": "member", "state": "observed", "value": "guneet"}, "check": {"scope": "Membership", "source": "Shinan''s member list", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Guneet", "summary": "The owner."}, {"op": "create-schema", "keys": {"expires": {"recheck": "90d"}, "registrar": {}}, "type": "domain", "owner": "person/guneet", "title": "Domains", "summary": "Internet domains the workspace holds.", "required": ["registrar"]}]', 0, 'applied', '{observed-or-unknown,body-and-bookkeeping,rules,people-and-agents}', '["Creates the type schema document schema/domain", "Changes the person entity person/guneet"]', '{person/guneet,schema/domain}', '[]', 'dataset-21', 'bsHAaya93frfjfwYTmLfZMrprFCWynx2Jz-Htffd39w', 1, '2026-11-20 17:06:35.314+00', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, 'ana', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('ffe26a4b-f073-45f7-9f1f-b288e144a13b', '245ec4ac-8126-443d-9bc5-8002458371c8', 2, '2026-11-20 17:06:35.357016+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "domain/example-org", "op": "create-entity", "body": "# example.org\n\nRenouvelé chaque année — 日本語のメモ — ✅\n", "facts": [{"fact": {"key": "registrar", "state": "observed", "value": "Example Registrar"}, "check": {"scope": "Read WHOIS", "source": "whois", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "example.org", "summary": "A domain of the dataset."}, {"id": "machine/old-box", "op": "create-entity", "facts": [{"fact": {"key": "role", "state": "observed", "value": "retired-host"}, "check": {"scope": "Read role", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.method", "state": "observed", "value": "ssh"}, "check": {"scope": "Read access.method", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.address", "state": "observed", "value": "203.0.113.20"}, "check": {"scope": "Read access.address", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "platform.os", "state": "observed", "value": "debian-13"}, "check": {"scope": "Read platform.os", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Old box", "summary": "A retired-host machine for the dataset."}, {"id": "machine/kojiro", "op": "create-entity", "facts": [{"fact": {"key": "role", "state": "observed", "value": "build"}, "check": {"scope": "Read role", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "environment", "state": "observed", "value": "production"}, "check": {"scope": "Read environment", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.method", "state": "observed", "value": "ssh"}, "check": {"scope": "Read access.method", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "access.address", "state": "observed", "value": "203.0.113.21"}, "check": {"scope": "Read access.address", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}, {"fact": {"key": "platform.os", "state": "observed", "value": "debian-13"}, "check": {"scope": "Read platform.os", "source": "The host", "checked": "2026-11-19T06:40:00Z"}}], "owner": "person/guneet", "title": "Kojiro", "summary": "A build machine for the dataset."}]', 1, 'applied', '{observed-or-unknown,body-and-bookkeeping}', '[]', '{domain/example-org,machine/kojiro,machine/old-box}', '[]', 'dataset-22', 'Yynta6kBPGvySD05Ry8pCzvdDd-oy1dxcpgRxNpV9GY', 2, '2026-11-20 17:06:35.378+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', 'guneet via opencode-daedalus', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('d9ac6c07-fdc8-420f-a7a7-df5f22d9d153', '245ec4ac-8126-443d-9bc5-8002458371c8', 3, '2026-11-20 17:06:35.397968+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"op": "retire", "expect": {"status": "active"}, "document": "machine/old-box"}]', 2, 'applied', '{lifecycle}', '["Changes the status of machine/old-box from active to retired"]', '{machine/old-box}', '[]', 'dataset-23', 'LlbJc717xFPK1Ubt2hmoy512XC5Y-fr_fG6seO5Gwj0', 3, '2026-11-20 17:06:35.43+00', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, 'ana', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('ec5e52b2-70df-4f73-ad1d-cda29ee9ba97', '245ec4ac-8126-443d-9bc5-8002458371c8', 4, '2026-11-20 17:06:35.453164+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"id": "machine/miyamoto", "op": "change-id", "document": "machine/kojiro"}]', 3, 'applied', '{lifecycle}', '["Changes the ID machine/kojiro to machine/miyamoto"]', '{machine/kojiro,machine/miyamoto}', '[]', 'dataset-24', 'GKfVDQ8CAg6eKAcQTiSkGBZYU83LxLIdBSI7rI8x2bA', 4, '2026-11-20 17:06:35.515+00', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, 'ana', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('c33eb8c8-8487-407b-b41e-529337d5225c', '245ec4ac-8126-443d-9bc5-8002458371c8', 5, '2026-11-20 17:06:35.575772+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"op": "create-start-here", "title": "Start here", "agents": [{"list": "known-unknowns", "note": "What nobody knows yet."}], "people": [{"to": "machine/miyamoto", "note": "The build machine."}, {"list": "waiting-for-approval", "note": "What waits for a person."}]}]', 4, 'applied', '{rules}', '["Changes the start-here document"]', '{start-here}', '[]', 'dataset-25', '-jZiOb2_GqP2EOiQACZN5wmgUNdOyBhrM64cOA93Tts', 5, '2026-11-20 17:06:35.631+00', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, 'ana', NULL, NULL);
INSERT INTO public.catalog_proposals VALUES ('1bc8cf46-7c66-488c-b30f-94edc6fd02a5', '245ec4ac-8126-443d-9bc5-8002458371c8', 6, '2026-11-20 17:06:35.667707+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"op": "retire", "expect": {"status": "active"}, "document": "domain/example-org"}]', 5, 'rejected', '{lifecycle}', '["Changes the status of domain/example-org from active to retired"]', '{domain/example-org}', '[]', 'dataset-26', 'c35AXJQntZp24FcAs53m_tn_Mn0_EbN7Pejy_U61YCI', NULL, '2026-11-20 17:06:35.696+00', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, 'ana', 'Still in use.', NULL);
INSERT INTO public.catalog_proposals VALUES ('66d4668f-f83b-40be-8038-edbd1cfc0fec', '245ec4ac-8126-443d-9bc5-8002458371c8', 7, '2026-11-20 17:06:35.757023+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'Recording what was checked.', NULL, '[{"op": "edit-body", "text": "# Miyamoto\n\nThe spare key is kept (purged).\n", "expect": {"text": ""}, "document": "machine/miyamoto"}]', 5, 'applied', '{body-and-bookkeeping}', '[]', '{machine/miyamoto}', '[]', NULL, 'WNcsfdj9KurHBDPD718mwO83vTYVzVm7GluIR0sysDs', 6, '2026-11-20 17:06:35.778+00', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', 'guneet via opencode-daedalus', NULL, NULL);


--
-- Data for Name: catalog_purges; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_purges VALUES ('96c5c16c-b29a-4d06-a32c-2a170a0b6303', '245ec4ac-8126-443d-9bc5-8002458371c8', 1, '2026-11-20 17:06:35.784368+00', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', 'Not to be kept.', '{"events": 0, "comments": 0, "documents": 1, "proposals": 1, "revisionTexts": 1, "latestDocuments": 1, "rejectedProposals": 0}', '993');


--
-- Data for Name: catalog_revision_documents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 1, '2d90b934-a419-42aa-9ed6-02d3b07e8773', '---
id: person/guneet
type: person
title: Guneet
summary: Owner of the workspace''s projects, machines and services.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Membership
    source: Shinan''s member list
    observed:
      member: guneet
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 2, 'dd67c540-6f25-47fc-8632-df08f4341bec', '---
id: machine/musashi
type: machine
title: Musashi
summary: A public-stacks machine for the dataset.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: public-stacks
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.10
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 3, '07748f43-2077-4140-a219-5329f1ece4cd', '---
id: machine/anzen
type: machine
title: Anzen
summary: A storage machine for the dataset.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: storage
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.11
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '0bab91bc-46ae-4461-a8dd-85e06e81ec4f', '---
id: machine/daedalus
type: machine
title: Daedalus
summary: A development machine for the dataset.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: development
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.12
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 5, 'd42c4d57-afe6-4122-8f58-3deffbec28de', '---
id: service/obscuro
type: service
title: Secrets
summary: Secrets, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://secrets.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 6, '818d0147-15e6-4104-8daf-6059de692de7', '---
id: service/cloudflare-dns
type: service
title: DNS
summary: DNS, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://dns.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 7, 'c10052c8-58dc-45c5-a29b-7ba26255eb2e', '---
id: service/ingress
type: service
title: HTTPS ingress
summary: HTTPS ingress, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://ingress.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 8, '66169daa-cec0-4afa-b241-e5d874f3202c', '---
id: service/forgejo
type: service
title: Git hosting
summary: Git hosting, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://git.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 9, '80b9c107-ba5d-468a-90f2-79b600ebeae5', '---
id: service/monitoring
type: service
title: Monitoring
summary: Monitoring, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://monitor.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/anzen
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 10, '260488e2-10c5-42e3-a773-51b84b78256d', '---
id: service/email
type: service
title: Email
summary: Email, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://mail.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 11, '6c7c0d83-e4d7-4faa-bf01-a234de5dd921', '---
id: service/shinan
type: service
title: Shinan
summary: Shinan, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://shinan.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 12, '9c51187c-a872-4900-b208-e7447817f680', '---
id: service/mon-private
type: service
title: Private board
summary: Private board, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://mon.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/anzen
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 13, '790ef0b6-3445-4e46-844c-9c54e3a349df', '---
id: service/mon-public
type: service
title: Public board
summary: Public board, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://status.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 14, '39a426f8-e640-4c65-8f39-2a9ff08ca72c', '---
id: service/easyshell
type: service
title: Shell lessons
summary: Shell lessons, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://shell.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/musashi
---
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 15, '29d82d55-cffc-4a03-ac03-c3e50b706dad', '---
id: project/shinan
type: project
title: Shinan
summary: The Shinan project.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read the remote
    source: git remote -v
    observed:
      repository: https://github.com/example/shinan
---

# Shinan

Notes kept by agents.
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 16, '588a7cbe-bcdb-472b-b47b-142e20cc4542', '---
id: project/mon
type: project
title: mon
summary: The mon project.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read the remote
    source: git remote -v
    observed:
      repository: https://github.com/example/mon
---

# mon

Notes kept by agents.
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 17, '802e1b36-b81c-4fcd-8794-35110cbaff61', '---
id: project/easyshell
type: project
title: easyshell
summary: The easyshell project.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read the remote
    source: git remote -v
    observed:
      repository: https://github.com/example/easyshell
---

# easyshell

Notes kept by agents.
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '07748f43-2077-4140-a219-5329f1ece4cd', '---
id: machine/anzen
type: machine
title: Anzen
summary: A storage machine for the dataset.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: storage
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.11
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
# Anzen

The backup repository is paused.
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '588a7cbe-bcdb-472b-b47b-142e20cc4542', '---
id: project/mon
type: project
title: mon
summary: The mon project.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read the remote
    source: git remote -v
    observed:
      repository: https://github.com/example/mon
---
# mon

Tiles for every check.
');
INSERT INTO public.catalog_revision_documents VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '9c51187c-a872-4900-b208-e7447817f680', '---
id: service/mon-private
type: service
title: Private board
summary: Private board, as the dataset has it.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Opened the endpoint
    source: curl -I
    observed:
      endpoint: https://mon.example.com
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read runs-on
    source: The host
    observed:
      runs-on: machine/anzen
---
# Private board

Reachable on the private network only.
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 1, '63b1a178-9000-4a1f-977f-21bb5461be59', '---
id: schema/domain
title: Domains
summary: Internet domains the workspace holds.
status: active
owner: person/guneet
keys:
  expires: { recheck: 90d }
  registrar: {}
required: [registrar]
---
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 1, '2c447413-4811-4a6f-8c09-35a1ac47f6f0', '---
id: person/guneet
type: person
title: Guneet
summary: The owner.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Membership
    source: Shinan''s member list
    observed:
      member: guneet
---
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 2, 'cf423327-6773-4730-affd-5776fe6b5e3d', '---
id: domain/example-org
type: domain
title: example.org
summary: A domain of the dataset.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read WHOIS
    source: whois
    observed:
      registrar: Example Registrar
---

# example.org

Renouvelé chaque année — 日本語のメモ — ✅
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 2, 'deb52502-50e4-4e3e-b676-c5a4718f7853', '---
id: machine/old-box
type: machine
title: Old box
summary: A retired-host machine for the dataset.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: retired-host
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.20
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 2, 'b346458d-2ea5-4dd2-9895-28011f1cb000', '---
id: machine/kojiro
type: machine
title: Kojiro
summary: A build machine for the dataset.
status: active
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: build
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.21
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 3, 'deb52502-50e4-4e3e-b676-c5a4718f7853', '---
id: machine/old-box
type: machine
title: Old box
summary: A retired-host machine for the dataset.
status: retired
owner: person/guneet
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: retired-host
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.20
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 4, 'b346458d-2ea5-4dd2-9895-28011f1cb000', '---
id: machine/miyamoto
type: machine
title: Kojiro
summary: A build machine for the dataset.
status: active
owner: person/guneet
aliases: [machine/kojiro]
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: build
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.21
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 5, '4ece431f-1600-4c76-a839-f37d0a213110', '---
id: start-here
title: Start here
people:
  - to: machine/miyamoto
    note: The build machine.
  - list: waiting-for-approval
    note: What waits for a person.
agents:
  - list: known-unknowns
    note: What nobody knows yet.
---
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 6, 'b346458d-2ea5-4dd2-9895-28011f1cb000', '---
id: machine/miyamoto
type: machine
title: Kojiro
summary: A build machine for the dataset.
status: active
owner: person/guneet
aliases: [machine/kojiro]
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: build
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.21
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
# Miyamoto

The spare key is kept (purged).
');
INSERT INTO public.catalog_revision_documents VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 7, 'b346458d-2ea5-4dd2-9895-28011f1cb000', '---
id: machine/miyamoto
type: machine
title: Kojiro
summary: A build machine for the dataset.
status: active
owner: person/guneet
aliases: [machine/kojiro]
facts:
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read role
    source: The host
    observed:
      role: build
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read environment
    source: The host
    observed:
      environment: production
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.method
    source: The host
    observed:
      access.method: ssh
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read access.address
    source: The host
    observed:
      access.address: 203.0.113.21
  - checked: 2026-11-19T06:40:00Z
    by: guneet via opencode-daedalus
    scope: Read platform.os
    source: The host
    observed:
      platform.os: debian-13
---
# Miyamoto

The spare key is kept (purged).
');


--
-- Data for Name: catalog_revisions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 1, '2026-11-20 17:06:34.087359+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '14ded99c-0ae4-4343-bd3b-b78acf32ce40', 0, 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'guneet', NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 2, '2026-11-20 17:06:34.154707+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '29c24392-5000-4b44-a069-7d480582173b', 1, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 3, '2026-11-20 17:06:34.203038+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'a61320f3-9d28-483b-939c-d323980eb87c', 2, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 4, '2026-11-20 17:06:34.252372+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '8b540c00-8214-4c55-b77d-3eaa9d4e1403', 3, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 5, '2026-11-20 17:06:34.298606+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '10cfa0c6-c5b2-44de-90a9-9c60e62fe00a', 4, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 6, '2026-11-20 17:06:34.337911+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '4009aa1d-9868-4e51-aab4-c0251f031f06', 5, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 7, '2026-11-20 17:06:34.377812+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '1c0966cc-3094-4d62-80f0-a28c3202fd62', 6, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 8, '2026-11-20 17:06:34.418574+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '76e2af9b-10db-4364-8a00-28c82c82770d', 7, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 9, '2026-11-20 17:06:34.465522+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '119fdba7-e7b0-434b-bdd4-d8ebfa89823e', 8, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 10, '2026-11-20 17:06:34.504025+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'cfb95955-e8e7-4510-a1fe-892b13917367', 9, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 11, '2026-11-20 17:06:34.545684+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '112f5fc8-6ff2-4144-9fb4-9dcb445e1ca0', 10, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 12, '2026-11-20 17:06:34.583546+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '860d0050-d8a1-43ad-a2f9-4111e95a9ac4', 11, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 13, '2026-11-20 17:06:34.62234+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'd538824c-e85b-43e2-a816-79c92bdb9850', 12, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 14, '2026-11-20 17:06:34.662892+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'dbed0c0d-3dab-472d-b296-6b7369bd1f93', 13, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 15, '2026-11-20 17:06:34.703256+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '7cc7ac89-2218-42cf-a504-d89ea23c8e2e', 14, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 16, '2026-11-20 17:06:34.750963+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', 'c6b4c972-ef12-4033-9efb-79a1dda8d141', 15, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 17, '2026-11-20 17:06:34.789982+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '000c3ea3-b98c-4bd7-aea6-5b59e83eb970', 16, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 18, '2026-11-20 17:06:34.88727+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '9dc831ce-be7e-46eb-9628-5775e6873a14', 17, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 1, '2026-11-20 17:06:35.301174+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '1661ef56-0cd1-4338-8820-610c6b5792fc', 0, 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'ana', NULL);
INSERT INTO public.catalog_revisions VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 2, '2026-11-20 17:06:35.357016+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'ffe26a4b-f073-45f7-9f1f-b288e144a13b', 1, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 3, '2026-11-20 17:06:35.416598+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'd9ac6c07-fdc8-420f-a7a7-df5f22d9d153', 2, 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'ana', NULL);
INSERT INTO public.catalog_revisions VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 4, '2026-11-20 17:06:35.477552+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'ec5e52b2-70df-4f73-ad1d-cda29ee9ba97', 3, 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'ana', NULL);
INSERT INTO public.catalog_revisions VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 5, '2026-11-20 17:06:35.605158+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', 'c33eb8c8-8487-407b-b41e-529337d5225c', 4, 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'ana', NULL);
INSERT INTO public.catalog_revisions VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 6, '2026-11-20 17:06:35.757023+00', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '66d4668f-f83b-40be-8038-edbd1cfc0fec', 5, NULL, NULL, NULL);
INSERT INTO public.catalog_revisions VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 7, '2026-11-20 17:06:35.784368+00', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', NULL, NULL, NULL, NULL, '96c5c16c-b29a-4d06-a32c-2a170a0b6303');


--
-- Data for Name: email_allowlist; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: email_changes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: email_deliveries; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.email_deliveries VALUES ('38838855-b057-435a-a6c3-6d0fc249f74d', 'security_alert', 'guneet@example.com', NULL, 'queued', 0, NULL, NULL, '2026-11-20 18:06:33.813+00', '{"html": "<!doctype html>\n<html>\n<head><meta charset=\"utf-8\"><title>Agent token approved for opencode-daedalus</title></head>\n<body style=\"font-family:sans-serif;line-height:1.5;max-width:560px\">\n<p>An agent token was approved for opencode-daedalus in the workspace &quot;Trial&quot; on Shinan on 2026-11-20 17:06 UTC.</p>\n<p>If this was you, there is nothing to do. If it was not, review your account now: end sign-in sessions you do not recognize and revoke tokens you did not approve.</p>\n<p><a href=\"https://localhost:18444/account/agents\">Review your account</a></p>\n<p style=\"color:#555;font-size:13px\">Or copy this address into your browser: https://localhost:18444/account/agents</p>\n</body>\n</html>\n", "text": "An agent token was approved for opencode-daedalus in the workspace \"Trial\" on Shinan on 2026-11-20 17:06 UTC.\n\nIf this was you, there is nothing to do. If it was not, review your account now: end sign-in sessions you do not recognize and revoke tokens you did not approve.\n\nhttps://localhost:18444/account/agents\n", "subject": "Agent token approved for opencode-daedalus"}', '2026-11-20 17:06:33.797963+00', NULL);
INSERT INTO public.email_deliveries VALUES ('247f3aa9-aaf2-40a3-97c9-d048ac7dd8c4', 'security_alert', 'guneet@example.com', NULL, 'queued', 0, NULL, NULL, '2026-11-20 18:06:35.006+00', '{"html": "<!doctype html>\n<html>\n<head><meta charset=\"utf-8\"><title>Agent token approved for opencode-daedalus</title></head>\n<body style=\"font-family:sans-serif;line-height:1.5;max-width:560px\">\n<p>An agent token was approved for opencode-daedalus in the workspace &quot;Shapes&quot; on Shinan on 2026-11-20 17:06 UTC.</p>\n<p>If this was you, there is nothing to do. If it was not, review your account now: end sign-in sessions you do not recognize and revoke tokens you did not approve.</p>\n<p><a href=\"https://localhost:18444/account/agents\">Review your account</a></p>\n<p style=\"color:#555;font-size:13px\">Or copy this address into your browser: https://localhost:18444/account/agents</p>\n</body>\n</html>\n", "text": "An agent token was approved for opencode-daedalus in the workspace \"Shapes\" on Shinan on 2026-11-20 17:06 UTC.\n\nIf this was you, there is nothing to do. If it was not, review your account now: end sign-in sessions you do not recognize and revoke tokens you did not approve.\n\nhttps://localhost:18444/account/agents\n", "subject": "Agent token approved for opencode-daedalus"}', '2026-11-20 17:06:34.996869+00', NULL);


--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (1, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:33.786014+00', 'workspace.created', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "a781e967-4156-4ab0-ace2-65cf5f3006f2", "type": "member"}]', 'guneet created the workspace Trial', '{"name": "Trial"}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (2, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:33.797963+00', 'agent.created', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "af86e78a-52ed-479c-bf2f-078cd0e13275", "type": "agent"}]', 'guneet registered the agent opencode-daedalus', '{"name": "opencode-daedalus", "machine": "daedalus", "codingTool": "opencode", "machineEntityId": null}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (3, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:33.797963+00', 'agent.token-issued', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "af86e78a-52ed-479c-bf2f-078cd0e13275", "type": "agent"}]', 'guneet issued a full token for opencode-daedalus', '{"access": "full", "tokenId": "c1aaf9a6-0552-4dd7-9b2f-aa31a10bac69", "replacedTokenId": null}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (4, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.059644+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "14ded99c-0ae4-4343-bd3b-b78acf32ce40", "type": "catalog-proposal"}]', 'guneet via opencode-daedalus proposed catalog change 1, waiting for approval: person/guneet', '{"number": 1, "touches": ["person/guneet"], "proposalId": "14ded99c-0ae4-4343-bd3b-b78acf32ce40", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping", "people-and-agents"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (5, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.087359+00', 'catalog.changed', 'shinan_action', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "14ded99c-0ae4-4343-bd3b-b78acf32ce40", "type": "catalog-proposal"}, {"id": "2d90b934-a419-42aa-9ed6-02d3b07e8773", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed person/guneet (catalog proposal 1, revision 1)', '{"number": 1, "touches": ["person/guneet"], "revision": 1, "approvedBy": "guneet", "proposalId": "14ded99c-0ae4-4343-bd3b-b78acf32ce40", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping", "people-and-agents"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (6, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.154707+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "29c24392-5000-4b44-a069-7d480582173b", "type": "catalog-proposal"}, {"id": "dd67c540-6f25-47fc-8632-df08f4341bec", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed machine/musashi (catalog proposal 2, revision 2)', '{"number": 2, "touches": ["machine/musashi"], "revision": 2, "proposalId": "29c24392-5000-4b44-a069-7d480582173b", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (7, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.203038+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "a61320f3-9d28-483b-939c-d323980eb87c", "type": "catalog-proposal"}, {"id": "07748f43-2077-4140-a219-5329f1ece4cd", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed machine/anzen (catalog proposal 3, revision 3)', '{"number": 3, "touches": ["machine/anzen"], "revision": 3, "proposalId": "a61320f3-9d28-483b-939c-d323980eb87c", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (8, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.252372+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "8b540c00-8214-4c55-b77d-3eaa9d4e1403", "type": "catalog-proposal"}, {"id": "0bab91bc-46ae-4461-a8dd-85e06e81ec4f", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed machine/daedalus (catalog proposal 4, revision 4)', '{"number": 4, "touches": ["machine/daedalus"], "revision": 4, "proposalId": "8b540c00-8214-4c55-b77d-3eaa9d4e1403", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (9, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.298606+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "10cfa0c6-c5b2-44de-90a9-9c60e62fe00a", "type": "catalog-proposal"}, {"id": "d42c4d57-afe6-4122-8f58-3deffbec28de", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/obscuro (catalog proposal 5, revision 5)', '{"number": 5, "touches": ["service/obscuro"], "revision": 5, "proposalId": "10cfa0c6-c5b2-44de-90a9-9c60e62fe00a", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (10, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.337911+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "4009aa1d-9868-4e51-aab4-c0251f031f06", "type": "catalog-proposal"}, {"id": "818d0147-15e6-4104-8daf-6059de692de7", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/cloudflare-dns (catalog proposal 6, revision 6)', '{"number": 6, "touches": ["service/cloudflare-dns"], "revision": 6, "proposalId": "4009aa1d-9868-4e51-aab4-c0251f031f06", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (11, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.377812+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "1c0966cc-3094-4d62-80f0-a28c3202fd62", "type": "catalog-proposal"}, {"id": "c10052c8-58dc-45c5-a29b-7ba26255eb2e", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/ingress (catalog proposal 7, revision 7)', '{"number": 7, "touches": ["service/ingress"], "revision": 7, "proposalId": "1c0966cc-3094-4d62-80f0-a28c3202fd62", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (12, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.418574+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "76e2af9b-10db-4364-8a00-28c82c82770d", "type": "catalog-proposal"}, {"id": "66169daa-cec0-4afa-b241-e5d874f3202c", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/forgejo (catalog proposal 8, revision 8)', '{"number": 8, "touches": ["service/forgejo"], "revision": 8, "proposalId": "76e2af9b-10db-4364-8a00-28c82c82770d", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (13, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.465522+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "119fdba7-e7b0-434b-bdd4-d8ebfa89823e", "type": "catalog-proposal"}, {"id": "80b9c107-ba5d-468a-90f2-79b600ebeae5", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/monitoring (catalog proposal 9, revision 9)', '{"number": 9, "touches": ["service/monitoring"], "revision": 9, "proposalId": "119fdba7-e7b0-434b-bdd4-d8ebfa89823e", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (14, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.504025+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "cfb95955-e8e7-4510-a1fe-892b13917367", "type": "catalog-proposal"}, {"id": "260488e2-10c5-42e3-a773-51b84b78256d", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/email (catalog proposal 10, revision 10)', '{"number": 10, "touches": ["service/email"], "revision": 10, "proposalId": "cfb95955-e8e7-4510-a1fe-892b13917367", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (15, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.545684+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "112f5fc8-6ff2-4144-9fb4-9dcb445e1ca0", "type": "catalog-proposal"}, {"id": "6c7c0d83-e4d7-4faa-bf01-a234de5dd921", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/shinan (catalog proposal 11, revision 11)', '{"number": 11, "touches": ["service/shinan"], "revision": 11, "proposalId": "112f5fc8-6ff2-4144-9fb4-9dcb445e1ca0", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (16, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.583546+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "860d0050-d8a1-43ad-a2f9-4111e95a9ac4", "type": "catalog-proposal"}, {"id": "9c51187c-a872-4900-b208-e7447817f680", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/mon-private (catalog proposal 12, revision 12)', '{"number": 12, "touches": ["service/mon-private"], "revision": 12, "proposalId": "860d0050-d8a1-43ad-a2f9-4111e95a9ac4", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (17, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.62234+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "d538824c-e85b-43e2-a816-79c92bdb9850", "type": "catalog-proposal"}, {"id": "790ef0b6-3445-4e46-844c-9c54e3a349df", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/mon-public (catalog proposal 13, revision 13)', '{"number": 13, "touches": ["service/mon-public"], "revision": 13, "proposalId": "d538824c-e85b-43e2-a816-79c92bdb9850", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (18, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.662892+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "dbed0c0d-3dab-472d-b296-6b7369bd1f93", "type": "catalog-proposal"}, {"id": "39a426f8-e640-4c65-8f39-2a9ff08ca72c", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed service/easyshell (catalog proposal 14, revision 14)', '{"number": 14, "touches": ["service/easyshell"], "revision": 14, "proposalId": "dbed0c0d-3dab-472d-b296-6b7369bd1f93", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (19, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.703256+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "7cc7ac89-2218-42cf-a504-d89ea23c8e2e", "type": "catalog-proposal"}, {"id": "29d82d55-cffc-4a03-ac03-c3e50b706dad", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed project/shinan (catalog proposal 15, revision 15)', '{"number": 15, "touches": ["project/shinan"], "revision": 15, "proposalId": "7cc7ac89-2218-42cf-a504-d89ea23c8e2e", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (20, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.750963+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "c6b4c972-ef12-4033-9efb-79a1dda8d141", "type": "catalog-proposal"}, {"id": "588a7cbe-bcdb-472b-b47b-142e20cc4542", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed project/mon (catalog proposal 16, revision 16)', '{"number": 16, "touches": ["project/mon"], "revision": 16, "proposalId": "c6b4c972-ef12-4033-9efb-79a1dda8d141", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (21, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.789982+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "000c3ea3-b98c-4bd7-aea6-5b59e83eb970", "type": "catalog-proposal"}, {"id": "802e1b36-b81c-4fcd-8794-35110cbaff61", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed project/easyshell (catalog proposal 17, revision 17)', '{"number": 17, "touches": ["project/easyshell"], "revision": 17, "proposalId": "000c3ea3-b98c-4bd7-aea6-5b59e83eb970", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (22, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.88727+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "9dc831ce-be7e-46eb-9628-5775e6873a14", "type": "catalog-proposal"}, {"id": "07748f43-2077-4140-a219-5329f1ece4cd", "type": "catalog-document"}, {"id": "588a7cbe-bcdb-472b-b47b-142e20cc4542", "type": "catalog-document"}, {"id": "9c51187c-a872-4900-b208-e7447817f680", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed machine/anzen, project/mon, service/mon-private (catalog proposal 18, revision 18)', '{"number": 18, "touches": ["machine/anzen", "project/mon", "service/mon-private"], "revision": 18, "proposalId": "9dc831ce-be7e-46eb-9628-5775e6873a14", "approvalClasses": ["body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (23, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.915277+00', 'catalog.strict-changed', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[]', 'guneet turned the catalog''s strict setting on', '{"strict": true}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (24, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.942201+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "fbc7e46a-15af-4c5b-8df7-5fe78ce1ca53", "type": "catalog-proposal"}]', 'guneet via opencode-daedalus proposed catalog change 19, waiting for approval: service/container-registry', '{"number": 19, "touches": ["service/container-registry"], "proposalId": "fbc7e46a-15af-4c5b-8df7-5fe78ce1ca53", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (25, '610d5273-74e3-4a7e-8a00-e96e141516a9', '2026-11-20 17:06:34.965293+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'af86e78a-52ed-479c-bf2f-078cd0e13275', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "ddd0c956-a5de-4ce9-9a4f-4355e5aa2957", "type": "catalog-proposal"}]', 'guneet via opencode-daedalus proposed catalog change 20, waiting for approval: start-here', '{"number": 20, "touches": ["start-here"], "proposalId": "ddd0c956-a5de-4ce9-9a4f-4355e5aa2957", "approvalClasses": ["rules"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (26, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:34.975952+00', 'workspace.created', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "6a441039-ac52-46b6-9e86-56c28d9f757f", "type": "member"}]', 'guneet created the workspace Shapes', '{"name": "Shapes"}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (27, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:34.983475+00', 'member.added', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "869b1d0e-06ba-454c-bf21-2a12aeb1e89c", "type": "member"}]', 'guneet added ana as contributor', '{"role": "contributor"}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (28, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:34.996869+00', 'agent.created', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "5df27c69-9444-4b42-b2ab-a46c0201aaef", "type": "agent"}]', 'guneet registered the agent opencode-daedalus', '{"name": "opencode-daedalus", "machine": "daedalus", "codingTool": "opencode", "machineEntityId": null}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (29, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:34.996869+00', 'agent.token-issued', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "5df27c69-9444-4b42-b2ab-a46c0201aaef", "type": "agent"}]', 'guneet issued a full token for opencode-daedalus', '{"access": "full", "tokenId": "3dd8e8eb-25c7-4db6-b61a-a7368be0c148", "replacedTokenId": null}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (30, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.279461+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "1661ef56-0cd1-4338-8820-610c6b5792fc", "type": "catalog-proposal"}]', 'guneet via opencode-daedalus proposed catalog change 1, waiting for approval: person/guneet, schema/domain', '{"number": 1, "touches": ["person/guneet", "schema/domain"], "proposalId": "1661ef56-0cd1-4338-8820-610c6b5792fc", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping", "rules", "people-and-agents"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (31, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.301174+00', 'catalog.changed', 'shinan_action', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "1661ef56-0cd1-4338-8820-610c6b5792fc", "type": "catalog-proposal"}, {"id": "63b1a178-9000-4a1f-977f-21bb5461be59", "type": "catalog-document"}, {"id": "2c447413-4811-4a6f-8c09-35a1ac47f6f0", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed person/guneet, schema/domain (catalog proposal 1, revision 1)', '{"number": 1, "touches": ["person/guneet", "schema/domain"], "revision": 1, "approvedBy": "ana", "proposalId": "1661ef56-0cd1-4338-8820-610c6b5792fc", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping", "rules", "people-and-agents"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (32, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.357016+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "ffe26a4b-f073-45f7-9f1f-b288e144a13b", "type": "catalog-proposal"}, {"id": "cf423327-6773-4730-affd-5776fe6b5e3d", "type": "catalog-document"}, {"id": "deb52502-50e4-4e3e-b676-c5a4718f7853", "type": "catalog-document"}, {"id": "b346458d-2ea5-4dd2-9895-28011f1cb000", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed domain/example-org, machine/kojiro, machine/old-box (catalog proposal 2, revision 2)', '{"number": 2, "touches": ["domain/example-org", "machine/kojiro", "machine/old-box"], "revision": 2, "proposalId": "ffe26a4b-f073-45f7-9f1f-b288e144a13b", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (33, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.397968+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "d9ac6c07-fdc8-420f-a7a7-df5f22d9d153", "type": "catalog-proposal"}, {"id": "deb52502-50e4-4e3e-b676-c5a4718f7853", "type": "catalog-document"}]', 'guneet via opencode-daedalus proposed catalog change 3, waiting for approval: machine/old-box', '{"number": 3, "touches": ["machine/old-box"], "proposalId": "d9ac6c07-fdc8-420f-a7a7-df5f22d9d153", "approvalClasses": ["lifecycle"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (34, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.416598+00', 'catalog.changed', 'shinan_action', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "d9ac6c07-fdc8-420f-a7a7-df5f22d9d153", "type": "catalog-proposal"}, {"id": "deb52502-50e4-4e3e-b676-c5a4718f7853", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed machine/old-box (catalog proposal 3, revision 3)', '{"number": 3, "touches": ["machine/old-box"], "revision": 3, "approvedBy": "ana", "proposalId": "d9ac6c07-fdc8-420f-a7a7-df5f22d9d153", "approvalClasses": ["lifecycle"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (35, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.453164+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "ec5e52b2-70df-4f73-ad1d-cda29ee9ba97", "type": "catalog-proposal"}, {"id": "b346458d-2ea5-4dd2-9895-28011f1cb000", "type": "catalog-document"}]', 'guneet via opencode-daedalus proposed catalog change 4, waiting for approval: machine/kojiro, machine/miyamoto', '{"number": 4, "touches": ["machine/kojiro", "machine/miyamoto"], "proposalId": "ec5e52b2-70df-4f73-ad1d-cda29ee9ba97", "approvalClasses": ["lifecycle"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (36, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.477552+00', 'catalog.changed', 'shinan_action', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "ec5e52b2-70df-4f73-ad1d-cda29ee9ba97", "type": "catalog-proposal"}, {"id": "b346458d-2ea5-4dd2-9895-28011f1cb000", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed machine/kojiro, machine/miyamoto (catalog proposal 4, revision 4)', '{"number": 4, "touches": ["machine/kojiro", "machine/miyamoto"], "revision": 4, "approvedBy": "ana", "proposalId": "ec5e52b2-70df-4f73-ad1d-cda29ee9ba97", "approvalClasses": ["lifecycle"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (37, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.575772+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "c33eb8c8-8487-407b-b41e-529337d5225c", "type": "catalog-proposal"}]', 'guneet via opencode-daedalus proposed catalog change 5, waiting for approval: start-here', '{"number": 5, "touches": ["start-here"], "proposalId": "c33eb8c8-8487-407b-b41e-529337d5225c", "approvalClasses": ["rules"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (38, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.605158+00', 'catalog.changed', 'shinan_action', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "c33eb8c8-8487-407b-b41e-529337d5225c", "type": "catalog-proposal"}, {"id": "4ece431f-1600-4c76-a839-f37d0a213110", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed start-here (catalog proposal 5, revision 5)', '{"number": 5, "touches": ["start-here"], "revision": 5, "approvedBy": "ana", "proposalId": "c33eb8c8-8487-407b-b41e-529337d5225c", "approvalClasses": ["rules"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (39, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.667707+00', 'catalog.proposal-waiting', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "1bc8cf46-7c66-488c-b30f-94edc6fd02a5", "type": "catalog-proposal"}, {"id": "cf423327-6773-4730-affd-5776fe6b5e3d", "type": "catalog-document"}]', 'guneet via opencode-daedalus proposed catalog change 6, waiting for approval: domain/example-org', '{"number": 6, "touches": ["domain/example-org"], "proposalId": "1bc8cf46-7c66-488c-b30f-94edc6fd02a5", "approvalClasses": ["lifecycle"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (40, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.686004+00', 'catalog.proposal-commented', 'shinan_action', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', '[{"id": "1bc8cf46-7c66-488c-b30f-94edc6fd02a5", "type": "catalog-proposal"}]', 'ana commented on catalog proposal 6', '{"number": 6, "commentId": "5c444cc7-a3c7-4627-9611-8cc4af96f87b", "proposalId": "1bc8cf46-7c66-488c-b30f-94edc6fd02a5"}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (41, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.694481+00', 'catalog.proposal-rejected', 'shinan_action', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', '[{"id": "1bc8cf46-7c66-488c-b30f-94edc6fd02a5", "type": "catalog-proposal"}]', 'ana rejected catalog proposal 6: domain/example-org', '{"number": 6, "reason": "Still in use.", "touches": ["domain/example-org"], "proposalId": "1bc8cf46-7c66-488c-b30f-94edc6fd02a5", "approvalClasses": ["lifecycle"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (42, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.757023+00', 'catalog.changed', 'mcp_call', 'agent', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '5df27c69-9444-4b42-b2ab-a46c0201aaef', NULL, 'guneet via opencode-daedalus', 'recorded', '[{"id": "66d4668f-f83b-40be-8038-edbd1cfc0fec", "type": "catalog-proposal"}, {"id": "b346458d-2ea5-4dd2-9895-28011f1cb000", "type": "catalog-document"}]', 'guneet via opencode-daedalus changed machine/miyamoto (catalog proposal 7, revision 6)', '{"number": 7, "touches": ["machine/miyamoto"], "revision": 6, "proposalId": "66d4668f-f83b-40be-8038-edbd1cfc0fec", "approvalClasses": ["body-and-bookkeeping"]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (43, '245ec4ac-8126-443d-9bc5-8002458371c8', '2026-11-20 17:06:35.784368+00', 'catalog.purged', 'shinan_action', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', '[{"id": "96c5c16c-b29a-4d06-a32c-2a170a0b6303", "type": "catalog-purge"}, {"id": "b346458d-2ea5-4dd2-9895-28011f1cb000", "type": "catalog-document"}, {"id": "66d4668f-f83b-40be-8038-edbd1cfc0fec", "type": "catalog-proposal"}]', 'guneet purged text from the catalog (purge 1): 1 revision text of 1 document, 1 catalog proposal', '{"counts": {"events": 0, "comments": 0, "documents": 1, "proposals": 1, "revisionTexts": 1, "latestDocuments": 1, "rejectedProposals": 0}, "number": 1, "reason": "Not to be kept.", "purgeId": "96c5c16c-b29a-4d06-a32c-2a170a0b6303", "revision": 7, "proposals": [7]}', NULL, NULL);
INSERT INTO public.events OVERRIDING SYSTEM VALUE VALUES (44, '07c49e48-b30a-46b0-898d-e094d4a6702b', '2026-11-20 17:06:35.864419+00', 'workspace.created', 'shinan_action', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', '[{"id": "ad06d4fe-accf-41a9-96ec-d908807332bc", "type": "member"}]', 'ana created the workspace Empty', '{"name": "Empty"}', NULL, NULL);


--
-- Data for Name: installation; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.installation VALUES (1, 'Shinan', '2026-11-20 17:06:33.763073+00', NULL);


--
-- Data for Name: installation_operators; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: invitations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: known_browsers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: members; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.members VALUES ('a781e967-4156-4ab0-ace2-65cf5f3006f2', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'owner', '2026-11-20 17:06:33.786014+00', NULL, NULL);
INSERT INTO public.members VALUES ('6a441039-ac52-46b6-9e86-56c28d9f757f', '245ec4ac-8126-443d-9bc5-8002458371c8', 'b005b805-4ee4-4b3e-be41-98f416a28b43', 'owner', '2026-11-20 17:06:34.975952+00', NULL, NULL);
INSERT INTO public.members VALUES ('869b1d0e-06ba-454c-bf21-2a12aeb1e89c', '245ec4ac-8126-443d-9bc5-8002458371c8', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'contributor', '2026-11-20 17:06:34.983475+00', '6a441039-ac52-46b6-9e86-56c28d9f757f', NULL);
INSERT INTO public.members VALUES ('ad06d4fe-accf-41a9-96ec-d908807332bc', '07c49e48-b30a-46b0-898d-e094d4a6702b', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'owner', '2026-11-20 17:06:35.864419+00', NULL, NULL);


--
-- Data for Name: pending_github_sign_ins; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: people; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.people VALUES ('b005b805-4ee4-4b3e-be41-98f416a28b43', 'guneet', 'Guneet', 'guneet@example.com', '2026-11-20 17:06:33.77085+00', true, NULL, '2026-11-20 17:06:33.77085+00');
INSERT INTO public.people VALUES ('dc5a54c2-c6ba-4b2c-8323-003760801b6b', 'ana', 'Ana', 'ana@example.com', '2026-11-20 17:06:33.781171+00', true, NULL, '2026-11-20 17:06:33.781171+00');


--
-- Data for Name: rate_limits; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.rate_limits VALUES ('catalog-proposal:af86e78a-52ed-479c-bf2f-078cd0e13275', '2026-11-20 17:06:33.833067+00', 20);
INSERT INTO public.rate_limits VALUES ('catalog-proposal:5df27c69-9444-4b42-b2ab-a46c0201aaef', '2026-11-20 17:06:35.021639+00', 7);


--
-- Data for Name: security_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (1, '2026-11-20 17:06:33.763073+00', NULL, 'installation.created', 'succeeded', 'shinan', NULL, NULL, NULL, 'shinan', 'recorded', NULL, NULL, NULL, '{"name": "Shinan"}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (2, '2026-11-20 17:06:33.77085+00', NULL, 'account.created', 'succeeded', 'shinan', NULL, NULL, NULL, 'shinan', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, '{"handle": "guneet"}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (3, '2026-11-20 17:06:33.781171+00', NULL, 'account.created', 'succeeded', 'shinan', NULL, NULL, NULL, 'shinan', 'recorded', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, '{"handle": "ana"}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (4, '2026-11-20 17:06:33.786014+00', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'workspace.created', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', NULL, '192.0.2.10', 'v0.3.0 dataset', '{"name": "Trial", "role": "owner", "memberId": "a781e967-4156-4ab0-ace2-65cf5f3006f2"}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (5, '2026-11-20 17:06:33.797963+00', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'agent.created', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"name": "opencode-daedalus", "handle": "opencode-daedalus", "agentId": "af86e78a-52ed-479c-bf2f-078cd0e13275", "machine": "daedalus", "codingTool": "opencode", "machineEntityId": null}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (6, '2026-11-20 17:06:33.797963+00', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'agent-token.issued', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"access": "full", "handle": "opencode-daedalus", "method": "by-hand", "scopes": ["catalog:read", "catalog:propose", "tasks:read", "tasks:write", "presence"], "agentId": "af86e78a-52ed-479c-bf2f-078cd0e13275", "tokenId": "c1aaf9a6-0552-4dd7-9b2f-aa31a10bac69", "replacedTokenId": null}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (7, '2026-11-20 17:06:34.087359+00', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'catalog-proposal.approved', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', NULL, '192.0.2.10', 'v0.3.0 dataset', '{"author": "guneet via opencode-daedalus", "number": 1, "revision": 1, "proposalId": "14ded99c-0ae4-4343-bd3b-b78acf32ce40", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping", "people-and-agents"]}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (8, '2026-11-20 17:06:34.915277+00', '610d5273-74e3-4a7e-8a00-e96e141516a9', 'catalog.strict-changed', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', NULL, '192.0.2.10', 'v0.3.0 dataset', '{"strict": true}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (9, '2026-11-20 17:06:34.975952+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'workspace.created', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', NULL, '192.0.2.10', 'v0.3.0 dataset', '{"name": "Shapes", "role": "owner", "memberId": "6a441039-ac52-46b6-9e86-56c28d9f757f"}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (10, '2026-11-20 17:06:34.983475+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'member.added', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', '192.0.2.10', 'v0.3.0 dataset', '{"role": "contributor", "memberId": "869b1d0e-06ba-454c-bf21-2a12aeb1e89c"}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (11, '2026-11-20 17:06:34.996869+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'agent.created', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"name": "opencode-daedalus", "handle": "opencode-daedalus", "agentId": "5df27c69-9444-4b42-b2ab-a46c0201aaef", "machine": "daedalus", "codingTool": "opencode", "machineEntityId": null}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (12, '2026-11-20 17:06:34.996869+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'agent-token.issued', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"access": "full", "handle": "opencode-daedalus", "method": "by-hand", "scopes": ["catalog:read", "catalog:propose", "tasks:read", "tasks:write", "presence"], "agentId": "5df27c69-9444-4b42-b2ab-a46c0201aaef", "tokenId": "3dd8e8eb-25c7-4db6-b61a-a7368be0c148", "replacedTokenId": null}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (13, '2026-11-20 17:06:35.301174+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'catalog-proposal.approved', 'succeeded', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"author": "guneet via opencode-daedalus", "number": 1, "revision": 1, "proposalId": "1661ef56-0cd1-4338-8820-610c6b5792fc", "approvalClasses": ["observed-or-unknown", "body-and-bookkeeping", "rules", "people-and-agents"]}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (14, '2026-11-20 17:06:35.416598+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'catalog-proposal.approved', 'succeeded', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"author": "guneet via opencode-daedalus", "number": 3, "revision": 3, "proposalId": "d9ac6c07-fdc8-420f-a7a7-df5f22d9d153", "approvalClasses": ["lifecycle"]}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (15, '2026-11-20 17:06:35.477552+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'catalog-proposal.approved', 'succeeded', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"author": "guneet via opencode-daedalus", "number": 4, "revision": 4, "proposalId": "ec5e52b2-70df-4f73-ad1d-cda29ee9ba97", "approvalClasses": ["lifecycle"]}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (16, '2026-11-20 17:06:35.605158+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'catalog-proposal.approved', 'succeeded', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"author": "guneet via opencode-daedalus", "number": 5, "revision": 5, "proposalId": "c33eb8c8-8487-407b-b41e-529337d5225c", "approvalClasses": ["rules"]}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (17, '2026-11-20 17:06:35.694481+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'catalog-proposal.rejected', 'succeeded', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', 'b005b805-4ee4-4b3e-be41-98f416a28b43', '192.0.2.10', 'v0.3.0 dataset', '{"author": "guneet via opencode-daedalus", "number": 6, "proposalId": "1bc8cf46-7c66-488c-b30f-94edc6fd02a5", "approvalClasses": ["lifecycle"]}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (18, '2026-11-20 17:06:35.784368+00', '245ec4ac-8126-443d-9bc5-8002458371c8', 'catalog.purged', 'succeeded', 'person', 'b005b805-4ee4-4b3e-be41-98f416a28b43', NULL, NULL, 'guneet', 'recorded', NULL, '192.0.2.10', 'v0.3.0 dataset', '{"counts": {"events": 0, "comments": 0, "documents": 1, "proposals": 1, "revisionTexts": 1, "latestDocuments": 1, "rejectedProposals": 0}, "number": 1, "purgeId": "96c5c16c-b29a-4d06-a32c-2a170a0b6303", "revision": 7}');
INSERT INTO public.security_log OVERRIDING SYSTEM VALUE VALUES (19, '2026-11-20 17:06:35.864419+00', '07c49e48-b30a-46b0-898d-e094d4a6702b', 'workspace.created', 'succeeded', 'person', 'dc5a54c2-c6ba-4b2c-8323-003760801b6b', NULL, NULL, 'ana', 'recorded', NULL, '192.0.2.10', 'v0.3.0 dataset', '{"name": "Empty", "role": "owner", "memberId": "ad06d4fe-accf-41a9-96ec-d908807332bc"}');


--
-- Data for Name: setup_links; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sign_in_accounts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sign_in_sessions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sign_in_verifications; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: workspaces; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.workspaces VALUES ('610d5273-74e3-4a7e-8a00-e96e141516a9', 'Trial', '2026-11-20 17:06:33.786014+00', true);
INSERT INTO public.workspaces VALUES ('245ec4ac-8126-443d-9bc5-8002458371c8', 'Shapes', '2026-11-20 17:06:34.975952+00', false);
INSERT INTO public.workspaces VALUES ('07c49e48-b30a-46b0-898d-e094d4a6702b', 'Empty', '2026-11-20 17:06:35.864419+00', false);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: -
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 13, true);


--
-- Name: events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.events_id_seq', 44, true);


--
-- Name: security_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.security_log_id_seq', 19, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: bam bam_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.bam
    ADD CONSTRAINT bam_pkey PRIMARY KEY (id);


--
-- Name: instance instance_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.instance
    ADD CONSTRAINT instance_pkey PRIMARY KEY (id);


--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (name, id);


--
-- Name: job_common job_common_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job_common
    ADD CONSTRAINT job_common_pkey PRIMARY KEY (name, id);


--
-- Name: job_dependency job_dependency_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job_dependency
    ADD CONSTRAINT job_dependency_pkey PRIMARY KEY (child_name, child_id, parent_name, parent_id);


--
-- Name: queue queue_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_pkey PRIMARY KEY (name);


--
-- Name: queue_stats queue_stats_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue_stats
    ADD CONSTRAINT queue_stats_pkey PRIMARY KEY (id, captured_on);


--
-- Name: queue_stats_20261120 queue_stats_20261120_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue_stats_20261120
    ADD CONSTRAINT queue_stats_20261120_pkey PRIMARY KEY (id, captured_on);


--
-- Name: queue_stats_20261121 queue_stats_20261121_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue_stats_20261121
    ADD CONSTRAINT queue_stats_20261121_pkey PRIMARY KEY (id, captured_on);


--
-- Name: schedule schedule_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_pkey PRIMARY KEY (name, key);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (event, name);


--
-- Name: version version_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.version
    ADD CONSTRAINT version_pkey PRIMARY KEY (version);


--
-- Name: warning warning_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.warning
    ADD CONSTRAINT warning_pkey PRIMARY KEY (id);


--
-- Name: agent_tokens agent_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tokens
    ADD CONSTRAINT agent_tokens_pkey PRIMARY KEY (id);


--
-- Name: agent_tokens agent_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tokens
    ADD CONSTRAINT agent_tokens_token_hash_unique UNIQUE (token_hash);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: agents agents_workspace_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_workspace_id_id UNIQUE (workspace_id, id);


--
-- Name: catalog_documents catalog_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_documents
    ADD CONSTRAINT catalog_documents_pkey PRIMARY KEY (id);


--
-- Name: catalog_documents catalog_documents_workspace_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_documents
    ADD CONSTRAINT catalog_documents_workspace_id_id UNIQUE (workspace_id, id);


--
-- Name: catalog_index_discrepancies catalog_index_discrepancies_document_id_key_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_discrepancies
    ADD CONSTRAINT catalog_index_discrepancies_document_id_key_pk PRIMARY KEY (document_id, key);


--
-- Name: catalog_index_documents catalog_index_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_documents
    ADD CONSTRAINT catalog_index_documents_pkey PRIMARY KEY (document_id);


--
-- Name: catalog_index_facts catalog_index_facts_document_id_position_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_facts
    ADD CONSTRAINT catalog_index_facts_document_id_position_pk PRIMARY KEY (document_id, "position");


--
-- Name: catalog_index_provenance catalog_index_provenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_provenance
    ADD CONSTRAINT catalog_index_provenance_pkey PRIMARY KEY (document_id);


--
-- Name: catalog_index_relations catalog_index_relations_document_id_position_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_relations
    ADD CONSTRAINT catalog_index_relations_document_id_position_pk PRIMARY KEY (document_id, "position");


--
-- Name: catalog_index_sections catalog_index_sections_document_id_position_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_sections
    ADD CONSTRAINT catalog_index_sections_document_id_position_pk PRIMARY KEY (document_id, "position");


--
-- Name: catalog_index_state catalog_index_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_state
    ADD CONSTRAINT catalog_index_state_pkey PRIMARY KEY (workspace_id);


--
-- Name: catalog_page_visits catalog_page_visits_workspace_id_person_id_document_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_page_visits
    ADD CONSTRAINT catalog_page_visits_workspace_id_person_id_document_id_pk PRIMARY KEY (workspace_id, person_id, document_id);


--
-- Name: catalog_proposal_comments catalog_proposal_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposal_comments
    ADD CONSTRAINT catalog_proposal_comments_pkey PRIMARY KEY (id);


--
-- Name: catalog_proposals catalog_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_pkey PRIMARY KEY (id);


--
-- Name: catalog_proposals catalog_proposals_workspace_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_workspace_id_id UNIQUE (workspace_id, id);


--
-- Name: catalog_proposals catalog_proposals_workspace_id_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_workspace_id_number UNIQUE (workspace_id, number);


--
-- Name: catalog_purges catalog_purges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_purges
    ADD CONSTRAINT catalog_purges_pkey PRIMARY KEY (id);


--
-- Name: catalog_purges catalog_purges_workspace_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_purges
    ADD CONSTRAINT catalog_purges_workspace_id_id UNIQUE (workspace_id, id);


--
-- Name: catalog_purges catalog_purges_workspace_id_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_purges
    ADD CONSTRAINT catalog_purges_workspace_id_number UNIQUE (workspace_id, number);


--
-- Name: catalog_revision_documents catalog_revision_documents_document_id_revision_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revision_documents
    ADD CONSTRAINT catalog_revision_documents_document_id_revision_pk PRIMARY KEY (document_id, revision);


--
-- Name: catalog_revisions catalog_revisions_workspace_id_number_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revisions
    ADD CONSTRAINT catalog_revisions_workspace_id_number_pk PRIMARY KEY (workspace_id, number);


--
-- Name: email_allowlist email_allowlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_allowlist
    ADD CONSTRAINT email_allowlist_pkey PRIMARY KEY (email);


--
-- Name: email_changes email_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_changes
    ADD CONSTRAINT email_changes_pkey PRIMARY KEY (person_id);


--
-- Name: email_changes email_changes_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_changes
    ADD CONSTRAINT email_changes_token_hash_unique UNIQUE (token_hash);


--
-- Name: email_deliveries email_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: installation_operators installation_operators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation_operators
    ADD CONSTRAINT installation_operators_pkey PRIMARY KEY (email);


--
-- Name: installation installation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installation
    ADD CONSTRAINT installation_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_hash_unique UNIQUE (token_hash);


--
-- Name: known_browsers known_browsers_person_id_browser_hash_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.known_browsers
    ADD CONSTRAINT known_browsers_person_id_browser_hash_pk PRIMARY KEY (person_id, browser_hash);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: members members_workspace_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_workspace_id_id UNIQUE (workspace_id, id);


--
-- Name: members members_workspace_id_id_person_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_workspace_id_id_person_id UNIQUE (workspace_id, id, person_id);


--
-- Name: pending_github_sign_ins pending_github_sign_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_github_sign_ins
    ADD CONSTRAINT pending_github_sign_ins_pkey PRIMARY KEY (id);


--
-- Name: pending_github_sign_ins pending_github_sign_ins_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_github_sign_ins
    ADD CONSTRAINT pending_github_sign_ins_token_hash_unique UNIQUE (token_hash);


--
-- Name: people people_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_email_unique UNIQUE (email);


--
-- Name: people people_handle_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_handle_unique UNIQUE (handle);


--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);


--
-- Name: security_log security_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_log
    ADD CONSTRAINT security_log_pkey PRIMARY KEY (id);


--
-- Name: setup_links setup_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setup_links
    ADD CONSTRAINT setup_links_pkey PRIMARY KEY (id);


--
-- Name: sign_in_accounts sign_in_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_accounts
    ADD CONSTRAINT sign_in_accounts_pkey PRIMARY KEY (id);


--
-- Name: sign_in_sessions sign_in_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_sessions
    ADD CONSTRAINT sign_in_sessions_pkey PRIMARY KEY (id);


--
-- Name: sign_in_sessions sign_in_sessions_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_sessions
    ADD CONSTRAINT sign_in_sessions_token_hash_unique UNIQUE (token_hash);


--
-- Name: sign_in_verifications sign_in_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_verifications
    ADD CONSTRAINT sign_in_verifications_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: job_common_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i1 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: job_common_i10; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i10 ON pgboss.job_common USING btree (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE ((state < 'active'::pgboss.job_state) AND (NOT blocked) AND (policy = 'key_strict_fifo'::text));


--
-- Name: job_common_i11; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i11 ON pgboss.job_common USING btree (name, priority DESC, created_on, start_after) WHERE ((state < 'active'::pgboss.job_state) AND (NOT blocked));


--
-- Name: job_common_i12; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i12 ON pgboss.job_common USING btree (source_root_id) WHERE (source_root_id IS NOT NULL);


--
-- Name: job_common_i13; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i13 ON pgboss.job_common USING btree (name, singleton_key) WHERE ((state = 'created'::pgboss.job_state) AND upsert_by_key);


--
-- Name: job_common_i14; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i14 ON pgboss.job_common USING btree (name, state, blocked, start_after) WHERE (state = ANY (ARRAY['created'::pgboss.job_state, 'retry'::pgboss.job_state, 'active'::pgboss.job_state, 'failed'::pgboss.job_state]));


--
-- Name: job_common_i15; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i15 ON pgboss.job_common USING btree (name, created_on);


--
-- Name: job_common_i16; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i16 ON pgboss.job_common USING btree (name, completed_on) WHERE (completed_on IS NOT NULL);


--
-- Name: job_common_i17; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i17 ON pgboss.job_common USING btree (name, singleton_key, created_on) WHERE ((state < 'active'::pgboss.job_state) AND (singleton_key IS NOT NULL));


--
-- Name: job_common_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i2 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: job_common_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i3 ON pgboss.job_common USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: job_common_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i4 ON pgboss.job_common USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: job_common_i6; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i6 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'exclusive'::text));


--
-- Name: job_common_i7; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i7 ON pgboss.job_common USING btree (name, group_id) WHERE ((state = 'active'::pgboss.job_state) AND (group_id IS NOT NULL));


--
-- Name: job_common_i8; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i8 ON pgboss.job_common USING btree (name, singleton_key) WHERE ((state = ANY (ARRAY['active'::pgboss.job_state, 'retry'::pgboss.job_state, 'failed'::pgboss.job_state])) AND (policy = 'key_strict_fifo'::text));


--
-- Name: job_common_i9; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i9 ON pgboss.job_common USING btree (name, id) WHERE (blocking AND (state = 'completed'::pgboss.job_state));


--
-- Name: job_dep_parent_idx; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_dep_parent_idx ON pgboss.job_dependency USING btree (parent_name, parent_id);


--
-- Name: queue_stats_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX queue_stats_i1 ON ONLY pgboss.queue_stats USING btree (name, captured_on DESC) INCLUDE (deferred_count, queued_count, ready_count, active_count, failed_count, total_count);


--
-- Name: queue_stats_20261120_name_captured_on_deferred_count_queued_idx; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX queue_stats_20261120_name_captured_on_deferred_count_queued_idx ON pgboss.queue_stats_20261120 USING btree (name, captured_on DESC) INCLUDE (deferred_count, queued_count, ready_count, active_count, failed_count, total_count);


--
-- Name: queue_stats_20261121_name_captured_on_deferred_count_queued_idx; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX queue_stats_20261121_name_captured_on_deferred_count_queued_idx ON pgboss.queue_stats_20261121 USING btree (name, captured_on DESC) INCLUDE (deferred_count, queued_count, ready_count, active_count, failed_count, total_count);


--
-- Name: warning_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX warning_i1 ON pgboss.warning USING btree (created_on DESC);


--
-- Name: agent_tokens_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_tokens_one_active ON public.agent_tokens USING btree (agent_id) WHERE (revoked_at IS NULL);


--
-- Name: agent_tokens_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_tokens_workspace_id ON public.agent_tokens USING btree (workspace_id);


--
-- Name: agents_member_handle; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agents_member_handle ON public.agents USING btree (member_id, handle);


--
-- Name: agents_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agents_person_id ON public.agents USING btree (person_id);


--
-- Name: agents_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agents_workspace_id ON public.agents USING btree (workspace_id);


--
-- Name: catalog_index_discrepancies_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_discrepancies_workspace_id ON public.catalog_index_discrepancies USING btree (workspace_id);


--
-- Name: catalog_index_documents_aliases; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_documents_aliases ON public.catalog_index_documents USING gin (aliases);


--
-- Name: catalog_index_documents_catalog_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_documents_catalog_id ON public.catalog_index_documents USING btree (workspace_id, catalog_id);


--
-- Name: catalog_index_documents_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_documents_search ON public.catalog_index_documents USING gin (search);


--
-- Name: catalog_index_documents_search_simple; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_documents_search_simple ON public.catalog_index_documents USING gin (search_simple);


--
-- Name: catalog_index_documents_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_documents_type_status ON public.catalog_index_documents USING btree (workspace_id, kind, type, status);


--
-- Name: catalog_index_documents_versions; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_documents_versions ON public.catalog_index_documents USING btree (workspace_id, parser_version, rules_version);


--
-- Name: catalog_index_facts_due_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_facts_due_at ON public.catalog_index_facts USING btree (workspace_id, due_at) WHERE (due_at IS NOT NULL);


--
-- Name: catalog_index_facts_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_facts_entity ON public.catalog_index_facts USING btree (workspace_id, entity_id);


--
-- Name: catalog_index_facts_unknown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_facts_unknown ON public.catalog_index_facts USING btree (workspace_id) WHERE (state = 'unknown'::text);


--
-- Name: catalog_index_provenance_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_provenance_workspace_id ON public.catalog_index_provenance USING btree (workspace_id);


--
-- Name: catalog_index_relations_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_relations_from ON public.catalog_index_relations USING btree (workspace_id, from_id);


--
-- Name: catalog_index_relations_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_relations_to ON public.catalog_index_relations USING btree (workspace_id, to_id);


--
-- Name: catalog_index_sections_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_sections_search ON public.catalog_index_sections USING gin (search);


--
-- Name: catalog_index_sections_search_simple; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_sections_search_simple ON public.catalog_index_sections USING gin (search_simple);


--
-- Name: catalog_index_sections_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_index_sections_workspace_id ON public.catalog_index_sections USING btree (workspace_id);


--
-- Name: catalog_proposal_comments_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX catalog_proposal_comments_idempotency_key ON public.catalog_proposal_comments USING btree (workspace_id, COALESCE(actor_agent_id, actor_person_id), idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: catalog_proposal_comments_proposal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_proposal_comments_proposal_id ON public.catalog_proposal_comments USING btree (proposal_id, created_at);


--
-- Name: catalog_proposals_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX catalog_proposals_idempotency_key ON public.catalog_proposals USING btree (workspace_id, COALESCE(actor_agent_id, actor_person_id), idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: catalog_proposals_reverts_proposal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_proposals_reverts_proposal_id ON public.catalog_proposals USING btree (reverts_proposal_id);


--
-- Name: catalog_proposals_touches; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_proposals_touches ON public.catalog_proposals USING gin (touches);


--
-- Name: catalog_proposals_workspace_id_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_proposals_workspace_id_state ON public.catalog_proposals USING btree (workspace_id, state);


--
-- Name: catalog_revision_documents_workspace_id_revision; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalog_revision_documents_workspace_id_revision ON public.catalog_revision_documents USING btree (workspace_id, revision);


--
-- Name: email_deliveries_network_address_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_network_address_created_at ON public.email_deliveries USING btree (network_address, created_at) WHERE (network_address IS NOT NULL);


--
-- Name: email_deliveries_recipient_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_recipient_created_at ON public.email_deliveries USING btree (recipient, created_at);


--
-- Name: email_deliveries_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_deliveries_status_created_at ON public.email_deliveries USING btree (status, created_at);


--
-- Name: events_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX events_idempotency_key ON public.events USING btree (workspace_id, idempotency_key);


--
-- Name: events_subjects; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_subjects ON public.events USING gin (subjects);


--
-- Name: events_workspace_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_workspace_id_id ON public.events USING btree (workspace_id, id);


--
-- Name: invitations_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_email ON public.invitations USING btree (email);


--
-- Name: invitations_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invitations_one_pending ON public.invitations USING btree (workspace_id, email) WHERE (state = 'pending'::public.invitation_state);


--
-- Name: members_one_current_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_one_current_membership ON public.members USING btree (workspace_id, person_id) WHERE (removed_at IS NULL);


--
-- Name: members_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_person_id ON public.members USING btree (person_id);


--
-- Name: security_log_actor_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_log_actor_person_id ON public.security_log USING btree (actor_person_id);


--
-- Name: security_log_subject_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_log_subject_person_id ON public.security_log USING btree (subject_person_id);


--
-- Name: security_log_workspace_id_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_log_workspace_id_id ON public.security_log USING btree (workspace_id, id);


--
-- Name: sign_in_accounts_person_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sign_in_accounts_person_provider ON public.sign_in_accounts USING btree (person_id, provider_id);


--
-- Name: sign_in_accounts_provider_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sign_in_accounts_provider_account ON public.sign_in_accounts USING btree (provider_id, account_id);


--
-- Name: sign_in_sessions_person_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sign_in_sessions_person_id ON public.sign_in_sessions USING btree (person_id);


--
-- Name: sign_in_verifications_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sign_in_verifications_identifier ON public.sign_in_verifications USING btree (identifier);


--
-- Name: job_common_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.job_common_pkey;


--
-- Name: queue_stats_20261120_name_captured_on_deferred_count_queued_idx; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.queue_stats_i1 ATTACH PARTITION pgboss.queue_stats_20261120_name_captured_on_deferred_count_queued_idx;


--
-- Name: queue_stats_20261120_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.queue_stats_pkey ATTACH PARTITION pgboss.queue_stats_20261120_pkey;


--
-- Name: queue_stats_20261121_name_captured_on_deferred_count_queued_idx; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.queue_stats_i1 ATTACH PARTITION pgboss.queue_stats_20261121_name_captured_on_deferred_count_queued_idx;


--
-- Name: queue_stats_20261121_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.queue_stats_pkey ATTACH PARTITION pgboss.queue_stats_20261121_pkey;


--
-- Name: catalog_purges catalog_purges_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER catalog_purges_append_only BEFORE DELETE OR UPDATE ON public.catalog_purges FOR EACH ROW EXECUTE FUNCTION public.shinan_refuse_purge_record_change();


--
-- Name: catalog_purges catalog_purges_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER catalog_purges_no_truncate BEFORE TRUNCATE ON public.catalog_purges FOR EACH STATEMENT EXECUTE FUNCTION public.shinan_refuse_change();


--
-- Name: catalog_revision_documents catalog_revision_documents_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER catalog_revision_documents_append_only BEFORE DELETE OR UPDATE ON public.catalog_revision_documents FOR EACH ROW EXECUTE FUNCTION public.shinan_refuse_change_except_purge('text');


--
-- Name: catalog_revision_documents catalog_revision_documents_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER catalog_revision_documents_no_truncate BEFORE TRUNCATE ON public.catalog_revision_documents FOR EACH STATEMENT EXECUTE FUNCTION public.shinan_refuse_change();


--
-- Name: catalog_revisions catalog_revisions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER catalog_revisions_append_only BEFORE DELETE OR UPDATE ON public.catalog_revisions FOR EACH ROW EXECUTE FUNCTION public.shinan_refuse_change();


--
-- Name: catalog_revisions catalog_revisions_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER catalog_revisions_no_truncate BEFORE TRUNCATE ON public.catalog_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.shinan_refuse_change();


--
-- Name: events events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_append_only BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.shinan_refuse_change_except_purge('summary', 'data');


--
-- Name: events events_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON public.events FOR EACH STATEMENT EXECUTE FUNCTION public.shinan_refuse_change();


--
-- Name: security_log security_log_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER security_log_append_only BEFORE DELETE OR UPDATE ON public.security_log FOR EACH ROW EXECUTE FUNCTION public.shinan_refuse_change();


--
-- Name: security_log security_log_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER security_log_no_truncate BEFORE TRUNCATE ON public.security_log FOR EACH STATEMENT EXECUTE FUNCTION public.shinan_refuse_change();


--
-- Name: job_common dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job_common
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: job_common q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job_common
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: queue queue_dead_letter_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_dead_letter_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name);


--
-- Name: schedule schedule_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: subscription subscription_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: agent_tokens agent_tokens_agent_same_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tokens
    ADD CONSTRAINT agent_tokens_agent_same_workspace FOREIGN KEY (workspace_id, agent_id) REFERENCES public.agents(workspace_id, id);


--
-- Name: agents agents_member_same_workspace_and_person; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_member_same_workspace_and_person FOREIGN KEY (workspace_id, member_id, person_id) REFERENCES public.members(workspace_id, id, person_id);


--
-- Name: agents agents_person_id_people_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_person_id_people_id_fk FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: agents agents_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: catalog_documents catalog_documents_current_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_documents
    ADD CONSTRAINT catalog_documents_current_revision_fk FOREIGN KEY (workspace_id, current_revision) REFERENCES public.catalog_revisions(workspace_id, number);


--
-- Name: catalog_documents catalog_documents_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_documents
    ADD CONSTRAINT catalog_documents_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: catalog_index_discrepancies catalog_index_discrepancies_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_discrepancies
    ADD CONSTRAINT catalog_index_discrepancies_document_fk FOREIGN KEY (document_id) REFERENCES public.catalog_index_documents(document_id) ON DELETE CASCADE;


--
-- Name: catalog_index_documents catalog_index_documents_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_documents
    ADD CONSTRAINT catalog_index_documents_document_fk FOREIGN KEY (workspace_id, document_id) REFERENCES public.catalog_documents(workspace_id, id);


--
-- Name: catalog_index_facts catalog_index_facts_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_facts
    ADD CONSTRAINT catalog_index_facts_document_fk FOREIGN KEY (document_id) REFERENCES public.catalog_index_documents(document_id) ON DELETE CASCADE;


--
-- Name: catalog_index_provenance catalog_index_provenance_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_provenance
    ADD CONSTRAINT catalog_index_provenance_document_fk FOREIGN KEY (document_id) REFERENCES public.catalog_index_documents(document_id) ON DELETE CASCADE;


--
-- Name: catalog_index_relations catalog_index_relations_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_relations
    ADD CONSTRAINT catalog_index_relations_document_fk FOREIGN KEY (document_id) REFERENCES public.catalog_index_documents(document_id) ON DELETE CASCADE;


--
-- Name: catalog_index_sections catalog_index_sections_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_sections
    ADD CONSTRAINT catalog_index_sections_document_fk FOREIGN KEY (document_id) REFERENCES public.catalog_index_documents(document_id) ON DELETE CASCADE;


--
-- Name: catalog_index_state catalog_index_state_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_index_state
    ADD CONSTRAINT catalog_index_state_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: catalog_page_visits catalog_page_visits_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_page_visits
    ADD CONSTRAINT catalog_page_visits_document_fk FOREIGN KEY (workspace_id, document_id) REFERENCES public.catalog_documents(workspace_id, id);


--
-- Name: catalog_page_visits catalog_page_visits_person_id_people_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_page_visits
    ADD CONSTRAINT catalog_page_visits_person_id_people_id_fk FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: catalog_proposal_comments catalog_proposal_comments_actor_agent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposal_comments
    ADD CONSTRAINT catalog_proposal_comments_actor_agent_id_fk FOREIGN KEY (actor_agent_id) REFERENCES public.agents(id);


--
-- Name: catalog_proposal_comments catalog_proposal_comments_actor_person_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposal_comments
    ADD CONSTRAINT catalog_proposal_comments_actor_person_id_fk FOREIGN KEY (actor_person_id) REFERENCES public.people(id);


--
-- Name: catalog_proposal_comments catalog_proposal_comments_proposal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposal_comments
    ADD CONSTRAINT catalog_proposal_comments_proposal_fk FOREIGN KEY (workspace_id, proposal_id) REFERENCES public.catalog_proposals(workspace_id, id);


--
-- Name: catalog_proposal_comments catalog_proposal_comments_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposal_comments
    ADD CONSTRAINT catalog_proposal_comments_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: catalog_proposals catalog_proposals_actor_agent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_actor_agent_id_fk FOREIGN KEY (actor_agent_id) REFERENCES public.agents(id);


--
-- Name: catalog_proposals catalog_proposals_actor_person_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_actor_person_id_fk FOREIGN KEY (actor_person_id) REFERENCES public.people(id);


--
-- Name: catalog_proposals catalog_proposals_decided_by_agent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_decided_by_agent_id_fk FOREIGN KEY (decided_by_agent_id) REFERENCES public.agents(id);


--
-- Name: catalog_proposals catalog_proposals_decided_by_person_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_decided_by_person_id_fk FOREIGN KEY (decided_by_person_id) REFERENCES public.people(id);


--
-- Name: catalog_proposals catalog_proposals_reverts_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_reverts_fk FOREIGN KEY (workspace_id, reverts_proposal_id) REFERENCES public.catalog_proposals(workspace_id, id);


--
-- Name: catalog_proposals catalog_proposals_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_proposals
    ADD CONSTRAINT catalog_proposals_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: catalog_purges catalog_purges_actor_person_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_purges
    ADD CONSTRAINT catalog_purges_actor_person_id_fk FOREIGN KEY (actor_person_id) REFERENCES public.people(id);


--
-- Name: catalog_purges catalog_purges_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_purges
    ADD CONSTRAINT catalog_purges_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: catalog_revision_documents catalog_revision_documents_document_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revision_documents
    ADD CONSTRAINT catalog_revision_documents_document_fk FOREIGN KEY (workspace_id, document_id) REFERENCES public.catalog_documents(workspace_id, id);


--
-- Name: catalog_revision_documents catalog_revision_documents_revision_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revision_documents
    ADD CONSTRAINT catalog_revision_documents_revision_fk FOREIGN KEY (workspace_id, revision) REFERENCES public.catalog_revisions(workspace_id, number);


--
-- Name: catalog_revisions catalog_revisions_actor_agent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revisions
    ADD CONSTRAINT catalog_revisions_actor_agent_id_fk FOREIGN KEY (actor_agent_id) REFERENCES public.agents(id);


--
-- Name: catalog_revisions catalog_revisions_actor_person_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revisions
    ADD CONSTRAINT catalog_revisions_actor_person_id_fk FOREIGN KEY (actor_person_id) REFERENCES public.people(id);


--
-- Name: catalog_revisions catalog_revisions_approved_by_person_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revisions
    ADD CONSTRAINT catalog_revisions_approved_by_person_id_fk FOREIGN KEY (approved_by_person_id) REFERENCES public.people(id);


--
-- Name: catalog_revisions catalog_revisions_proposal_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revisions
    ADD CONSTRAINT catalog_revisions_proposal_fk FOREIGN KEY (workspace_id, proposal_id) REFERENCES public.catalog_proposals(workspace_id, id);


--
-- Name: catalog_revisions catalog_revisions_purge_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revisions
    ADD CONSTRAINT catalog_revisions_purge_fk FOREIGN KEY (workspace_id, purge_id) REFERENCES public.catalog_purges(workspace_id, id);


--
-- Name: catalog_revisions catalog_revisions_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_revisions
    ADD CONSTRAINT catalog_revisions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: email_changes email_changes_person_id_people_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_changes
    ADD CONSTRAINT email_changes_person_id_people_id_fk FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: events events_actor_agent_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_actor_agent_id_fk FOREIGN KEY (actor_agent_id) REFERENCES public.agents(id);


--
-- Name: events events_actor_person_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_actor_person_id_fk FOREIGN KEY (actor_person_id) REFERENCES public.people(id);


--
-- Name: events events_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: invitations invitations_invited_by_same_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_same_workspace FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES public.members(workspace_id, id);


--
-- Name: invitations invitations_member_same_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_member_same_workspace FOREIGN KEY (workspace_id, member_id) REFERENCES public.members(workspace_id, id);


--
-- Name: invitations invitations_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: known_browsers known_browsers_person_id_people_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.known_browsers
    ADD CONSTRAINT known_browsers_person_id_people_id_fk FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: members members_invited_by_same_workspace; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_invited_by_same_workspace FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES public.members(workspace_id, id);


--
-- Name: members members_person_id_people_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_person_id_people_id_fk FOREIGN KEY (person_id) REFERENCES public.people(id);


--
-- Name: members members_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: sign_in_accounts sign_in_accounts_person_id_people_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_accounts
    ADD CONSTRAINT sign_in_accounts_person_id_people_id_fk FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: sign_in_sessions sign_in_sessions_person_id_people_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sign_in_sessions
    ADD CONSTRAINT sign_in_sessions_person_id_people_id_fk FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


