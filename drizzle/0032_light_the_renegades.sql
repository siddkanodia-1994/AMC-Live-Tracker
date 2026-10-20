CREATE TABLE "etf_daily_aum_estimate" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheme_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"estimated_aum_cr" numeric(18, 4) NOT NULL,
	"raw_compounded_aum_cr" numeric(18, 4) NOT NULL,
	"daily_flow_cr" numeric(18, 4) NOT NULL,
	"anchor_start_date" date NOT NULL,
	"anchor_end_date" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etf_exit_aum_anchor" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheme_id" integer NOT NULL,
	"anchor_date" date NOT NULL,
	"exit_aum_cr" numeric(18, 4) NOT NULL,
	"source_file" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "etf_daily_aum_estimate" ADD CONSTRAINT "etf_daily_aum_estimate_scheme_id_etf_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."etf_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etf_exit_aum_anchor" ADD CONSTRAINT "etf_exit_aum_anchor_scheme_id_etf_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."etf_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "etf_daily_aum_estimate_scheme_date_idx" ON "etf_daily_aum_estimate" USING btree ("scheme_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "etf_exit_aum_anchor_scheme_date_idx" ON "etf_exit_aum_anchor" USING btree ("scheme_id","anchor_date");