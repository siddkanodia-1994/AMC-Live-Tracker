CREATE TABLE "amc_valuation_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"date" date NOT NULL,
	"pe_cons" numeric(12, 4),
	"pe_sa" numeric(12, 4),
	"mcap_ns_cons" numeric(12, 4),
	"mcap_ns_sa" numeric(12, 4),
	"source_file" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amc_valuation_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"date" date NOT NULL,
	"field" text NOT NULL,
	"old_value" numeric(12, 4),
	"new_value" numeric(12, 4),
	"source_file" text NOT NULL,
	"revised_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_valuation_daily" ADD CONSTRAINT "amc_valuation_daily_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_valuation_revision" ADD CONSTRAINT "amc_valuation_revision_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_valuation_daily_amc_date_idx" ON "amc_valuation_daily" USING btree ("amc_id","date");--> statement-breakpoint
CREATE INDEX "amc_valuation_revision_amc_date_idx" ON "amc_valuation_revision" USING btree ("amc_id","date");