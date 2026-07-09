CREATE TABLE "total_aum_growth_override_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"report_period" text NOT NULL,
	"field" text NOT NULL,
	"old_value_cr" numeric(18, 4),
	"new_value_cr" numeric(18, 4),
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "total_aum_growth_override_log" ADD CONSTRAINT "total_aum_growth_override_log_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "total_aum_growth_override_log_amc_period_idx" ON "total_aum_growth_override_log" USING btree ("amc_id","report_period");