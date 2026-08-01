CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('generating', 'validating', 'playable', 'active', 'completed', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planning', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TABLE "ability_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ability_document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"markdown" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ability_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"status" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"embedding" vector(1536),
	"last_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ability_evidence_links" (
	"ability_document_version_id" uuid NOT NULL,
	"attempt_event_id" uuid NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "ability_evidence_links_ability_document_version_id_attempt_event_id_pk" PRIMARY KEY("ability_document_version_id","attempt_event_id")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"context_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"estimated_cost_micros" bigint,
	"latency_ms" integer,
	"final_action" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attempt_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempt_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"markdown" text NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "attempt_status" DEFAULT 'active' NOT NULL,
	"latest_event_sequence" integer DEFAULT -1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "challenge_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"validated_at" timestamp with time zone,
	"validation_report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"failure_signatures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_nodes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "concept_relations" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "concept_relations_from_id_to_id_kind_pk" PRIMARY KEY("from_id","to_id","kind")
);
--> statement-breakpoint
CREATE TABLE "learner_remarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"training_target_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"language" text NOT NULL,
	"kind" text NOT NULL,
	"difficulty" text NOT NULL,
	"status" "question_status" DEFAULT 'generating' NOT NULL,
	"challenge_artifact_id" uuid,
	"engine_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_health" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"migration_version" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"event_sequence" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"original_goal" text NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"status" "session_status" DEFAULT 'planning' NOT NULL,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ability_document_id" uuid,
	"action" text NOT NULL,
	"specific_gap" text NOT NULL,
	"desired_evidence" text NOT NULL,
	"avoid_testing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ability_document_versions" ADD CONSTRAINT "ability_document_versions_ability_document_id_ability_documents_id_fk" FOREIGN KEY ("ability_document_id") REFERENCES "public"."ability_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ability_documents" ADD CONSTRAINT "ability_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ability_documents" ADD CONSTRAINT "ability_documents_concept_id_concept_nodes_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concept_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ability_evidence_links" ADD CONSTRAINT "ability_evidence_links_ability_document_version_id_ability_document_versions_id_fk" FOREIGN KEY ("ability_document_version_id") REFERENCES "public"."ability_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ability_evidence_links" ADD CONSTRAINT "ability_evidence_links_attempt_event_id_attempt_events_id_fk" FOREIGN KEY ("attempt_event_id") REFERENCES "public"."attempt_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_traces" ADD CONSTRAINT "attempt_traces_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_artifacts" ADD CONSTRAINT "challenge_artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_from_id_concept_nodes_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."concept_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_relations" ADD CONSTRAINT "concept_relations_to_id_concept_nodes_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."concept_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_remarks" ADD CONSTRAINT "learner_remarks_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_remarks" ADD CONSTRAINT "learner_remarks_event_id_attempt_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."attempt_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_training_target_id_training_targets_id_fk" FOREIGN KEY ("training_target_id") REFERENCES "public"."training_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checkpoints" ADD CONSTRAINT "session_checkpoints_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checkpoints" ADD CONSTRAINT "session_checkpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_targets" ADD CONSTRAINT "training_targets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_snapshots" ADD CONSTRAINT "workspace_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_snapshots" ADD CONSTRAINT "workspace_snapshots_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ability_versions_idx" ON "ability_document_versions" USING btree ("ability_document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ability_user_concept_idx" ON "ability_documents" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_events_sequence_idx" ON "attempt_events" USING btree ("attempt_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_traces_version_idx" ON "attempt_traces" USING btree ("attempt_id","version");--> statement-breakpoint
CREATE INDEX "attempts_user_updated_idx" ON "attempts" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_artifact_hash_idx" ON "challenge_artifacts" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_session_ordinal_idx" ON "questions" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "session_checkpoint_version_idx" ON "session_checkpoints" USING btree ("session_id","version");--> statement-breakpoint
CREATE INDEX "sessions_user_updated_idx" ON "sessions" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
DO $$
DECLARE managed_table text;
BEGIN
  FOREACH managed_table IN ARRAY ARRAY[
    'ability_document_versions', 'ability_documents', 'ability_evidence_links',
    'agent_runs', 'attempt_events', 'attempt_traces', 'attempts', 'auth_accounts',
    'challenge_artifacts', 'concept_nodes', 'concept_relations', 'learner_remarks',
    'questions', 'schema_health', 'session_checkpoints', 'sessions',
    'training_targets', 'user_settings', 'users', 'workspace_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', managed_table);
  END LOOP;
END $$;
