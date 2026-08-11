CREATE TABLE "stale_mapping_correction_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"company_name" text NOT NULL,
	"old_security_id" text,
	"old_exchange_segment" text,
	"new_security_id" text NOT NULL,
	"new_exchange_segment" text NOT NULL,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL
);
