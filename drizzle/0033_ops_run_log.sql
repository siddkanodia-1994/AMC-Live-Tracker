CREATE TABLE "ops_run_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"source" text NOT NULL,
	"loop" text NOT NULL,
	"node" text NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ops_run_log_created_at_idx" ON "ops_run_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ops_run_log_loop_created_at_idx" ON "ops_run_log" USING btree ("loop","created_at");