CREATE TABLE "amc_valuation_estimate" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"pat_cr" numeric(18, 4),
	"revenue_cr" numeric(18, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_valuation_estimate" ADD CONSTRAINT "amc_valuation_estimate_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_valuation_estimate_amc_fy_idx" ON "amc_valuation_estimate" USING btree ("amc_id","fiscal_year");