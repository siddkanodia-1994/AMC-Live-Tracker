import { sql } from "drizzle-orm";
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
    // Every figure above is actually only the AMC's Growth/Equity Funds AUM slice --
    // confirmed from the source workbook, which breaks each AMC's Total MF AUM into
    // three categories (Growth/Equity + Income/Debt + Other = Total). These two
    // categories were never parsed until the Total AUM Growth tab needed them.
    // Nullable: periods imported before this feature don't have them until backfilled.
    incomeDebtAumCr: numeric("income_debt_aum_cr", { precision: 18, scale: 4 }),
    prevIncomeDebtAumCr: numeric("prev_income_debt_aum_cr", { precision: 18, scale: 4 }),
    otherFundsAumCr: numeric("other_funds_aum_cr", { precision: 18, scale: 4 }),
    prevOtherFundsAumCr: numeric("prev_other_funds_aum_cr", { precision: 18, scale: 4 }),
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

// Key-value settings: 'dhan_access_token', 'dhan_client_id',
// 'current_report_period', 'usd_inr_rate', 'usd_inr_rate_as_of'.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per AMC per calendar day PER REPORT PERIOD being priced. A given
// (amcId, snapshotDate) pair can have MULTIPLE rows -- one per reportPeriod
// that's been repriced to that date -- e.g. both a reportPeriod='2026-05' row
// (May's real, live-tracked value) and a reportPeriod='2026-02' row (a
// hypothetical "what would Feb's frozen holdings be worth on this date" AUM
// Growth comparison), for the same date.
//
// isCanonical marks the ONE row per (amcId, snapshotDate) -- across every
// reportPeriod ever repriced to that date -- that represents real, actually-
// tracked history: either the daily cron's live write for "today", or
// whichever period's own natural forward-extension backfill first
// established that date. Every other reportPeriod's row for that same date
// is an ad-hoc AUM Growth comparison value and must never be read by code
// that wants "the" AUM for a date (trend charts, 1-day change, avg-AUM-since-
// report) -- see history.ts. Enforced at the DB level by
// live_aum_daily_snapshot_amc_date_canonical_idx below: a UNIQUE index scoped
// to isCanonical = true, so at most one row per (amcId, snapshotDate) can
// ever claim canonical status, regardless of any application bug.
// live_aum_daily_snapshot_amc_date_period_idx (the other unique index) makes
// writes for one specific reportPeriod idempotent, the same role the old
// (amcId, snapshotDate) constraint played before multiple reportPeriods per
// date were possible.
export const liveAumDailySnapshot = pgTable(
  "live_aum_daily_snapshot",
  {
    id: serial("id").primaryKey(),
    amcId: integer("amc_id")
      .notNull()
      .references(() => amcs.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    reportPeriod: text("report_period").notNull(),
    isCanonical: boolean("is_canonical").notNull().default(true),
    liveAumCr: numeric("live_aum_cr", { precision: 18, scale: 4 }).notNull(),
    reportedAumCr: numeric("reported_aum_cr", { precision: 18, scale: 4 }).notNull(),
    deltaCr: numeric("delta_cr", { precision: 18, scale: 4 }).notNull(),
    deltaPct: numeric("delta_pct", { precision: 12, scale: 8 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_aum_daily_snapshot_amc_date_period_idx").on(t.amcId, t.snapshotDate, t.reportPeriod),
    uniqueIndex("live_aum_daily_snapshot_amc_date_canonical_idx")
      .on(t.amcId, t.snapshotDate)
      .where(sql`${t.isCanonical} = true`),
  ]
);

// One row per ISIN per calendar day — deduplicated industry-wide (a stock
// held by 50 AMCs stores one price row, not 50), mirroring the same
// distinct-by-ISIN approach used elsewhere for pricing/counts. Powers each
// holding's "1 Day Change" column. Unique on (isin, snapshotDate); overwritten
// intraday the same way live_aum_daily_snapshot is, so today's row tracks the
// latest computation rather than freezing on the first one.
export const isinDailyPrice = pgTable(
  "isin_daily_price",
  {
    id: serial("id").primaryKey(),
    isin: text("isin").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    priceInr: numeric("price_inr", { precision: 18, scale: 4 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("isin_daily_price_isin_date_idx").on(t.isin, t.snapshotDate)]
);

// One row per AMC per month, parsed once from the source workbook's "Cash
// Holdings" sheet (column K block -- confirmed a genuine one-row-per-AMC
// table of blended Cash & Cash Equivalent % of AUM, not scheme-specific).
// That sheet's window is a rolling 6 months, so this is persisted rather
// than re-parsed on every page load: future uploads can insert new months
// via the same import script without losing older ones the sheet itself
// has already rolled off. ccePct is a fraction (0.051, not 5.1), matching
// every other *Pct column in this schema and formatPct's expected input.
export const officialCceHistory = pgTable(
  "official_cce_history",
  {
    id: serial("id").primaryKey(),
    amcId: integer("amc_id")
      .notNull()
      .references(() => amcs.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // "2025-12".."2026-05"
    ccePct: numeric("cce_pct", { precision: 12, scale: 8 }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("official_cce_history_amc_month_idx").on(t.amcId, t.month)]
);

// Manual overrides for the Total AUM Growth tab's editable columns (SIP Inflows,
// Reported AUM, Income/Debt AUM, Other Funds AUM). One row per AMC per report period;
// each column is nullable, meaning "not overridden -- use the computed/parsed default."
// Scoped to reportPeriod (not a calendar date) since these represent "current period"
// figures: overrides naturally stop applying once a new month is imported and
// current_report_period advances, while old periods' overrides remain as history.
export const totalAumGrowthOverrides = pgTable(
  "total_aum_growth_overrides",
  {
    id: serial("id").primaryKey(),
    amcId: integer("amc_id")
      .notNull()
      .references(() => amcs.id, { onDelete: "cascade" }),
    reportPeriod: text("report_period").notNull(),
    sipInflowOverrideCr: numeric("sip_inflow_override_cr", { precision: 18, scale: 4 }),
    reportedAumOverrideCr: numeric("reported_aum_override_cr", { precision: 18, scale: 4 }),
    incomeDebtAumOverrideCr: numeric("income_debt_aum_override_cr", { precision: 18, scale: 4 }),
    otherFundsAumOverrideCr: numeric("other_funds_aum_override_cr", { precision: 18, scale: 4 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("total_aum_growth_overrides_amc_period_idx").on(t.amcId, t.reportPeriod)]
);

// Audit trail for the manual edits above: one row per changed field per save,
// so hand-entered figures stay traceable (what the override was before, what
// it became, when). Value semantics match the override columns themselves —
// null oldValueCr = "was the computed default (not overridden)", null
// newValueCr = "reset back to the computed default".
export const totalAumGrowthOverrideLog = pgTable(
  "total_aum_growth_override_log",
  {
    id: serial("id").primaryKey(),
    amcId: integer("amc_id")
      .notNull()
      .references(() => amcs.id, { onDelete: "cascade" }),
    reportPeriod: text("report_period").notNull(),
    // Which override column changed — same names as the API/DB fields
    // (sipInflowOverrideCr, reportedAumOverrideCr, incomeDebtAumOverrideCr,
    // otherFundsAumOverrideCr).
    field: text("field").notNull(),
    oldValueCr: numeric("old_value_cr", { precision: 18, scale: 4 }),
    newValueCr: numeric("new_value_cr", { precision: 18, scale: 4 }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("total_aum_growth_override_log_amc_period_idx").on(t.amcId, t.reportPeriod)]
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
