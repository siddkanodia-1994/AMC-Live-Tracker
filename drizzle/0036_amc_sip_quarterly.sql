CREATE TABLE "amc_sip_quarterly" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"sip_cr" numeric(18, 4),
	"sip_eq_aum_pct" numeric(7, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amc_sip_quarterly_quarter_check" CHECK ("amc_sip_quarterly"."quarter" BETWEEN 1 AND 4)
);
--> statement-breakpoint
ALTER TABLE "amc_sip_quarterly" ADD CONSTRAINT "amc_sip_quarterly_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_sip_quarterly_amc_fy_q_idx" ON "amc_sip_quarterly" USING btree ("amc_id","fiscal_year","quarter");