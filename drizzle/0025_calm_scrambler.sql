CREATE TABLE "amc_fortnightly_update" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"no_of_shares_cr" numeric(18, 4),
	"pat_fy26a_cr" numeric(18, 4),
	"pat_fy27e_cr" numeric(18, 4),
	"pat_fy28e_cr" numeric(18, 4),
	"target_pe_bear" numeric(10, 2),
	"target_pe_base" numeric(10, 2),
	"target_pe_bull" numeric(10, 2),
	"discount_rate_fy27_pct" numeric(7, 4),
	"discount_rate_fy26_pct" numeric(7, 4),
	"sip_amc_qtd_val_cr" numeric(18, 4),
	"sip_amc_qtd_pct" numeric(7, 4),
	"sip_amc_prev_q_val_cr" numeric(18, 4),
	"sip_amc_prev_q_pct" numeric(7, 4),
	"sip_amc_prev_q2_val_cr" numeric(18, 4),
	"sip_amc_prev_q2_pct" numeric(7, 4),
	"sip_amc_yoy_q_val_cr" numeric(18, 4),
	"sip_amc_yoy_q_pct" numeric(7, 4),
	"sip_amc_yoy_q2_val_cr" numeric(18, 4),
	"sip_amc_yoy_q2_pct" numeric(7, 4),
	"sip_industry_mtd_val_cr" numeric(18, 4),
	"sip_industry_prev_m_val_cr" numeric(18, 4),
	"sip_industry_prev_m2_val_cr" numeric(18, 4),
	"sip_industry_yoy_m_val_cr" numeric(18, 4),
	"sip_industry_yoy_m2_val_cr" numeric(18, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_fortnightly_update" ADD CONSTRAINT "amc_fortnightly_update_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_fortnightly_update_amc_date_idx" ON "amc_fortnightly_update" USING btree ("amc_id","as_of_date");