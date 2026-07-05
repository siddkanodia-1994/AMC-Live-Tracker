CREATE TABLE "official_cce_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"month" text NOT NULL,
	"cce_pct" numeric(12, 8) NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "official_cce_history" ADD CONSTRAINT "official_cce_history_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "official_cce_history_amc_month_idx" ON "official_cce_history" USING btree ("amc_id","month");