CREATE TABLE "foreign_instrument_map" (
	"isin" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"company_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foreign_price_cache" (
	"isin" text PRIMARY KEY NOT NULL,
	"price_usd" numeric(18, 4) NOT NULL,
	"as_of_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
