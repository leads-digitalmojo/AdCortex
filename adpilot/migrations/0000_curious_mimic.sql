CREATE TABLE "analysis_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"openapi_api_key" text DEFAULT '' NOT NULL,
	"gemini_model" text DEFAULT 'gemini-1.5-flash' NOT NULL,
	"gemini_image_model" text DEFAULT 'gemini-2.0-flash-preview-image-generation' NOT NULL,
	"groq_api_key" text DEFAULT '' NOT NULL,
	"groq_model" text DEFAULT 'llama-3.3-70b-versatile' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"project" text NOT NULL,
	"location" text NOT NULL,
	"target_locations" jsonb DEFAULT '[]'::jsonb,
	"platforms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"targets" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "creative_hubs" (
	"client_id" text PRIMARY KEY NOT NULL,
	"setup" jsonb DEFAULT 'null'::jsonb,
	"threads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "execution_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"platform" text NOT NULL,
	"intent" text NOT NULL,
	"command" text NOT NULL,
	"action_type" text NOT NULL,
	"campaign_ids" jsonb NOT NULL,
	"rationale" text,
	"safety_warnings" text,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "execution_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"log_id" text NOT NULL,
	"client_id" text NOT NULL,
	"metric_type" text NOT NULL,
	"pre_value" numeric NOT NULL,
	"post_value" numeric,
	"recorded_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analysis_client_platform" ON "analysis_snapshots" USING btree ("client_id","platform");