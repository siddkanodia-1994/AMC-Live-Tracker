CREATE TABLE "isin_daily_price" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"price_inr" numeric(18, 4) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "isin_daily_price_isin_date_idx" ON "isin_daily_price" USING btree ("isin","snapshot_date");