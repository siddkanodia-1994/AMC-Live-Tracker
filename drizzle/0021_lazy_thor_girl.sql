ALTER TABLE "import_log" ADD COLUMN "reclaim_status" text;--> statement-breakpoint
ALTER TABLE "import_log" ADD COLUMN "reclaim_error" text;--> statement-breakpoint
ALTER TABLE "import_log" ADD COLUMN "reclaim_completed_at" timestamp with time zone;