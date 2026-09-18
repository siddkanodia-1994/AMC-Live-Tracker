CREATE TABLE "amc_listed_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"amc_id" integer NOT NULL,
	"isin" text NOT NULL,
	"trading_symbol" text NOT NULL,
	"backfill_from_date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amc_listed_stock" ADD CONSTRAINT "amc_listed_stock_amc_id_amcs_id_fk" FOREIGN KEY ("amc_id") REFERENCES "public"."amcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amc_listed_stock_amc_id_idx" ON "amc_listed_stock" USING btree ("amc_id");