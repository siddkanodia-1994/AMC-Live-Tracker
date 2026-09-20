CREATE TABLE "amc_historical_aum_anchor" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"report_month" text NOT NULL,
	"month_end_date" date NOT NULL,
	"exit_aum_cr" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amc_historical_aum_estimate" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"estimated_aum_cr" numeric(18, 4) NOT NULL,
	"raw_compounded_aum_cr" numeric(18, 4) NOT NULL,
	"anchor_month_end_date" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_historical_aum_anchor" ADD CONSTRAINT "amc_historical_aum_anchor_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amc_historical_aum_estimate" ADD CONSTRAINT "amc_historical_aum_estimate_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_historical_aum_anchor_amc_month_idx" ON "amc_historical_aum_anchor" USING btree ("amc_id","report_month");--> statement-breakpoint
CREATE UNIQUE INDEX "amc_historical_aum_estimate_amc_date_idx" ON "amc_historical_aum_estimate" USING btree ("amc_id","snapshot_date");