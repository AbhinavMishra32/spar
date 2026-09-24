CREATE TABLE "agent_eval_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"value" jsonb NOT NULL,
	"comment" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_trace_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"phase" integer,
	"call_id" text,
	"level" text DEFAULT 'DEFAULT' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_attempt_id_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "origin" text DEFAULT 'product' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "status" text DEFAULT 'running' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "turn_kind" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "app_version" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "input" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "output" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cached_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "event_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "telemetry_exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_eval_scores" ADD CONSTRAINT "agent_eval_scores_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace_events" ADD CONSTRAINT "agent_trace_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_eval_scores_run_name_idx" ON "agent_eval_scores" USING btree ("run_id","name","source");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_trace_events_sequence_idx" ON "agent_trace_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "agent_trace_events_kind_idx" ON "agent_trace_events" USING btree ("kind","occurred_at");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_user_started_idx" ON "agent_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_session_started_idx" ON "agent_runs" USING btree ("session_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_status_started_idx" ON "agent_runs" USING btree ("status","started_at");
--> statement-breakpoint
/* Telemetry is ingested through Spar's authenticated API, never through the
   Supabase data API. RLS therefore has no client policy: the database owner used
   by the backend may write, while PostgREST roles (when this is Supabase) get no
   table privilege. The conditional revokes keep the migration portable to Neon
   and ordinary PostgreSQL, where those roles do not exist. */
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_trace_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_eval_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "agent_runs", "agent_trace_events", "agent_eval_scores" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "agent_runs", "agent_trace_events", "agent_eval_scores" FROM authenticated;
  END IF;
END $$;
