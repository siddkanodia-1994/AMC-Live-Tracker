import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  boolean,
  date,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Static AMC identity — one row per AMC, ever. Written once on first import.
export const amcs = pgTable(
  "amcs",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    overviewName: text("overview_name").notNull(),
    sheetName: text("sheet_name").notNull(),
  },
  (t) => [uniqueIndex("amcs_slug_idx").on(t.slug)]
);

// Per-period reported figures for an AMC. Unique on (amcId, reportPeriod) so
// re-uploading the same month's file is an upsert (last upload wins), while
// older periods are retained for history.
export const amcPeriods = pgTable(
  "amc_periods",
  {
    id: serial("id").primaryKey(),
    amcId: integer("amc_id")
      .notNull()
      .references(() => amcs.id, { onDelete: "cascade" }),
    reportPeriod: text("report_period").notNull(), // "2026-06"
    reportedAumCr: numeric("reported_aum_cr", { precision: 18, scale: 4 }).notNull(),
    prevReportedAumCr: numeric("prev_reported_aum_cr", { precision: 18, scale: 4 }),
    changeMomPct: numeric("change_mom_pct", { precision: 12, scale: 8 }),
    changeCr: numeric("change_cr", { precision: 18, scale: 4 }),
    sheetTotalHoldingsValueCr: numeric("sheet_total_holdings_value_cr", {
      precision: 18,
      scale: 4,
    }).notNull(),
    residualPlugCr: numeric("residual_plug_cr", { precision: 18, scale: 4 }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("amc_periods_amc_period_idx").on(t.amcId, t.reportPeriod)]
);

// Per-holding rows for an AMC in a given period. Re-import deletes+reinserts
// only the rows scoped to (amcId, reportPeriod) — other periods are untouched.
export const holdings = pgTable(
  "holdings",
  {
    id: serial("id").primaryKey(),
    amcId: integer("amc_id")
      .notNull()
      .references(() => amcs.id, { onDelete: "cascade" }),
    reportPeriod: text("report_period").notNull(),
    companyName: text("company_name").notNull(),
    sector: text("sector").notNull(),
    mcapClassification: text("mcap_classification"),
    isin: text("isin"), // null when source had "0" or blank
    isPriceable: boolean("is_priceable").notNull(),
    marketValueCr: numeric("market_value_cr", { precision: 18, scale: 4 }).notNull(),
    shares: numeric("shares", { precision: 20, scale: 2 }).notNull(),
    weightPct: numeric("weight_pct", { precision: 12, scale: 8 }),
    prevMarketValueCr: numeric("prev_market_value_cr", { precision: 18, scale: 4 }),
    prevShares: numeric("prev_shares", { precision: 20, scale: 2 }),
    prevWeightPct: numeric("prev_weight_pct", { precision: 12, scale: 8 }),
    changeMarketValueCr: numeric("change_market_value_cr", { precision: 18, scale: 4 }),
    changeShares: numeric("change_shares", { precision: 20, scale: 2 }),
    changeWeightPct: numeric("change_weight_pct", { precision: 12, scale: 8 }),
  },
  (t) => [
    index("holdings_amc_period_idx").on(t.amcId, t.reportPeriod),
    index("holdings_amc_period_isin_idx").on(t.amcId, t.reportPeriod, t.isin),
    index("holdings_isin_idx").on(t.isin),
  ]
);

// ISIN -> DHAN security_id mapping. Not period-scoped.
export const instrumentMap = pgTable("instrument_map", {
  isin: text("isin").primaryKey(),
  securityId: text("security_id").notNull(),
  exchangeSegment: text("exchange_segment").notNull(), // "NSE_EQ" | "BSE_EQ"
  tradingSymbol: text("trading_symbol"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ISIN -> Finnhub ticker symbol, for US-listed holdings. Synced rarely
// (Finnhub's symbol search resolves ISIN -> symbol directly, no manual
// mapping needed) — mirrors instrument_map's role but for foreign equities.
export const foreignInstrumentMap = pgTable("foreign_instrument_map", {
  isin: text("isin").primaryKey(),
  symbol: text("symbol").notNull(),
  companyName: text("company_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Daily-refreshed USD price cache for US-listed holdings — refreshed once a
// day (via cron) rather than fetched live per-request, since Finnhub's quote
// is only as fresh as the last US market close anyway during IST hours.
export const foreignPriceCache = pgTable("foreign_price_cache", {
  isin: text("isin").primaryKey(),
  priceUsd: numeric("price_usd", { precision: 18, scale: 4 }).notNull(),
  asOfDate: date("as_of_date").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Key-value settings: 'dhan_access_token', 'dhan_token_updated_at',
// 'current_report_period', 'usd_inr_rate', 'usd_inr_rate_as_of'.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per AMC per calendar day, written as a side-effect of computing a
// fresh live-AUM snapshot. Unique on (amcId, snapshotDate) makes writes idempotent.
export const liveAumDailySnapshot = pgTable(
  "live_aum_daily_snapshot",
  {
    id: serial("id").primaryKey(),
    amcId: integer("amc_id")
      .notNull()
      .references(() => amcs.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    reportPeriod: text("report_period").notNull(),
    liveAumCr: numeric("live_aum_cr", { precision: 18, scale: 4 }).notNull(),
    reportedAumCr: numeric("reported_aum_cr", { precision: 18, scale: 4 }).notNull(),
    deltaCr: numeric("delta_cr", { precision: 18, scale: 4 }).notNull(),
    deltaPct: numeric("delta_pct", { precision: 12, scale: 8 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("live_aum_daily_snapshot_amc_date_idx").on(t.amcId, t.snapshotDate)]
);

// Audit trail for imports.
export const importLog = pgTable("import_log", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  reportPeriod: text("report_period").notNull(),
  amcsImported: integer("amcs_imported").notNull(),
  holdingsImported: integer("holdings_imported").notNull(),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
