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

// Cross-instance coordination for DHAN's global (account-wide, not per-
// instance) 1 request/sec rate limit -- Vercel runs several concurrent
// serverless instances, each with its own independent in-memory cache (see
// cache.ts), so without this, multiple instances whose ~45s in-memory TTLs
// expire close together each independently call DHAN, and the combined
// request rate can exceed DHAN's real limit even though each instance's own
// fetchLtps() paces itself correctly in isolation. Confirmed as the live
// cause of a production incident on 2026-08-06 (two fresh computations
// ~105s apart both got a 429 rejecting the entire batch). Single fixed-id
// row -- the limit is DHAN-account-wide, not scoped to report period --
// atomically claimed via cache.ts's claimDhanFetchLease, an
// INSERT...ON CONFLICT...WHERE...RETURNING, NOT pg_advisory_lock: this
// app's db client (neon-http) is a stateless per-query HTTP driver with no
// persistent session for a lock to survive across, and the alternative
// WebSocket driver (transactional-client.ts) routes through Neon's
// PgBouncer transaction-mode pooler, which only guarantees a lock is safe
// inside one held transaction -- and holding a transaction open across a
// multi-second external DHAN call is an anti-pattern under pooling.
export const liveAumFetchLease = pgTable("live_aum_fetch_lease", {
  id: text("id").primaryKey(), // always the constant "dhan_ltp_fetch"
  ownerToken: text("owner_token").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
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

// Overview-page benchmark rows (Nifty 50 / Nifty 500), kept entirely
// separate from the amcs/liveAumDailySnapshot tables so they never get
// summed into industry-wide AMC totals/counts. One row per index per
// calendar day, overwritten intraday the same way isinDailyPrice is --
// today's row is the "live" level; once no more polls arrive for that
// date it stands as the permanent historical close.
export const indexDailyLevel = pgTable(
  "index_daily_level",
  {
    id: serial("id").primaryKey(),
    indexKey: text("index_key").notNull(), // 'NIFTY_50' | 'NIFTY_500'
    snapshotDate: date("snapshot_date").notNull(),
    levelValue: numeric("level_value", { precision: 18, scale: 4 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("index_daily_level_key_date_idx").on(t.indexKey, t.snapshotDate)]
);

// Idempotency guard AND visible audit trail for the automatic DHAN-outage
// detection+self-correction system (outage-detection.ts/outage-reclaim.ts).
// One row per (kind, snapshotDate). kind='amc_isin': a calendar date where
// the industry-wide last-close signature looked like a genuine DHAN outage
// (not a holiday -- see getRealTradingDatesInWindow). kind='index_level': a
// date where index_daily_level had a genuine gap for NIFTY 50/500. status
// starts 'detected' the moment the anomaly is first flagged; becomes
// 'corrected' once a real DHAN historical close has been written back (or
// 'no_data' if DHAN's historical endpoint genuinely had nothing for that
// date even with a healthy token -- rare, e.g. every affected ISIN
// delisted); 'failed' if the correction attempt itself threw (retried on a
// later cron run, unlike the other two terminal states).
export const outageReclaimLog = pgTable(
  "outage_reclaim_log",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // 'amc_isin' | 'index_level'
    snapshotDate: date("snapshot_date").notNull(),
    status: text("status").notNull(), // 'detected' | 'corrected' | 'no_data' | 'failed'
    lastCloseIsinCount: integer("last_close_isin_count"), // amc_isin only
    universeIsinCount: integer("universe_isin_count"), // amc_isin only
    correctedIsinCount: integer("corrected_isin_count"), // amc_isin only
    indexKeysCorrected: jsonb("index_keys_corrected").$type<string[]>(), // index_level only
    detail: text("detail"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("outage_reclaim_log_kind_date_idx").on(t.kind, t.snapshotDate)]
);

// One row per auto-corrected DHAN security-ID mapping drift (see
// stale-mapping-reclaim.ts): a single ISIN stuck on last_close for the
// auto-mute threshold's worth of trading days turned out to have a stale
// instrument_map entry (DHAN reissued its security ID and we never
// re-synced), self-corrected without human intervention. Distinct from
// outageReclaimLog above, which only ever fires for a whole-day,
// whole-universe outage (>=50% of ISINs last_close on one date) -- this
// catches the opposite shape of problem: one ISIN, wrong every day, for
// possibly many days, invisible to that day-level threshold. No unique
// constraint -- the same ISIN could in principle drift again later and
// get a second row.
export const staleMappingCorrectionLog = pgTable("stale_mapping_correction_log", {
  id: serial("id").primaryKey(),
  isin: text("isin").notNull(),
  companyName: text("company_name").notNull(),
  oldSecurityId: text("old_security_id"), // null if there was no prior mapping at all
  oldExchangeSegment: text("old_exchange_segment"),
  newSecurityId: text("new_security_id").notNull(),
  newExchangeSegment: text("new_exchange_segment").notNull(),
  correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per (ISIN, trading date) where that ISIN was classified
// priceSource === "last_close" that day -- written once daily by the 4:05pm
// IST close-capture cron (not on every 45s poll), so a transient intraday
// blip doesn't count as a full missed day. Append-only historical record,
// used to compute "N consecutive trading days without a live price" for the
// Overview banner's auto-mute feature -- see getMutedIsins in
// src/lib/aum/last-close-mute.ts.
export const isinLastCloseLog = pgTable(
  "isin_last_close_log",
  {
    id: serial("id").primaryKey(),
    isin: text("isin").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("isin_last_close_log_isin_date_idx").on(t.isin, t.snapshotDate)]
);

// Active manual mutes -- one row per ISIN currently muted via the Overview
// banner's "Accept" flow (a known, human-confirmed reason like a merger or
// delisting), distinct from isinLastCloseLog's append-only history. Cleared
// by the daily cron the moment that ISIN gets a real live price again,
// mirroring the auto-mute timer's own "streak resets to 0 on recovery"
// behavior.
export const isinManualMute = pgTable("isin_manual_mute", {
  isin: text("isin").primaryKey(),
  reason: text("reason").notNull(),
  mutedAt: timestamp("muted_at", { withTimezone: true }).notNull().defaultNow(),
});

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

// One row per trading day: how much of that day's industry-wide holding
// universe actually got a live DHAN close, vs. debt/foreign/cash-equivalent
// lines that never could. The regression guard for the February backfill
// gap (which sat undetected for months) -- Total/Debt/Foreign/Live counts
// are industry-wide distinct counts (deduped by ISIN, or by lowercased
// company name for the no-ISIN debt/repo/cash lines), matching whichever
// reportPeriod each AMC's liveAumDailySnapshot canonically used that day.
// Upserted (unique on snapshotDate), not append-only, so a future
// re-backfill (like today's February fix) can simply recompute and
// overwrite the affected days rather than leaving stale rows behind.
export const dailyDataQuality = pgTable(
  "daily_data_quality",
  {
    id: serial("id").primaryKey(),
    snapshotDate: date("snapshot_date").notNull(),
    totalHoldings: integer("total_holdings").notNull(),
    debtInstruments: integer("debt_instruments").notNull(),
    foreignHoldings: integer("foreign_holdings").notNull(),
    // No ISIN and not debt/repo -- cash-equivalent lines ("Net Current
    // Asset", "Cash & Cash Equivalent"), no-ISIN derivative/option
    // positions, and defunct/delisted listings. Deliberately excludes the
    // handful of no-ISIN debt/repo lines (TREPS, Call Money, CBLO), which
    // stay inside debtInstruments above -- keeps every column mutually
    // exclusive so totalHoldings - debtInstruments - foreignHoldings -
    // nonIsinBearing - infFundUnits partitions cleanly with nothing double
    // counted and nothing left over.
    nonIsinBearing: integer("non_isin_bearing").notNull(),
    // Indian ISIN-bearing but "INF"-prefixed -- one AMC holding units of
    // another mutual fund/ETF, not an individual stock. isPriceable is
    // already false for these (see parse-amc-sheet.ts), so they were
    // already excluded from liveConsidered; this column makes that
    // exclusion visible instead of leaving them silently inside
    // indianStocks.
    infFundUnits: integer("inf_fund_units").notNull(),
    // TS property renamed from indianStocksAndCash now that the two extra
    // categories above are broken out separately -- physical column name
    // kept as-is (indian_stocks_and_cash) to avoid an ambiguous rename
    // migration; only the meaning/value changes, not the column identity.
    indianStocks: integer("indian_stocks_and_cash").notNull(),
    liveConsidered: integer("live_considered").notNull(),
    coveragePct: numeric("coverage_pct", { precision: 6, scale: 3 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_data_quality_date_idx").on(t.snapshotDate)]
);

// Current active per-(isin, reportPeriod) share-count correction, applied at
// live-compute read time on top of holdings.shares (never mutated) when a
// stock split/bonus is auto-detected (see split-detection.ts): the imported
// share count predates the split, so liveMarketValueCr = price * shares
// understates/overstates by the split ratio until the next import reports
// the corrected count. dismissedAt/dismissedReason let an admin reverse a
// wrong auto-detection (e.g. a coincidental price-ratio match that wasn't
// really a split) -- once dismissed, detection still logs new events for
// that (isin, reportPeriod) but stops re-activating this row automatically.
export const isinShareAdjustment = pgTable(
  "isin_share_adjustment",
  {
    id: serial("id").primaryKey(),
    isin: text("isin").notNull(),
    reportPeriod: text("report_period").notNull(),
    effectiveMultiplier: numeric("effective_multiplier", { precision: 14, scale: 6 }).notNull(),
    firstDetectedOn: date("first_detected_on").notNull(),
    lastDetectedOn: date("last_detected_on").notNull(),
    detectionCount: integer("detection_count").notNull().default(1),
    lastPriceBeforeInr: numeric("last_price_before_inr", { precision: 18, scale: 4 }).notNull(),
    lastPriceAfterInr: numeric("last_price_after_inr", { precision: 18, scale: 4 }).notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedReason: text("dismissed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("isin_share_adjustment_isin_period_idx").on(t.isin, t.reportPeriod)]
);

// Append-only audit trail, one row per detected split/bonus event -- survives
// even after isinShareAdjustment is dismissed or its multiplier compounds
// further, and gives the daily cron idempotency for free (same
// onConflictDoNothing pattern as isinLastCloseLog).
export const isinShareAdjustmentLog = pgTable(
  "isin_share_adjustment_log",
  {
    id: serial("id").primaryKey(),
    isin: text("isin").notNull(),
    reportPeriod: text("report_period").notNull(),
    detectedOn: date("detected_on").notNull(),
    priceBeforeInr: numeric("price_before_inr", { precision: 18, scale: 4 }).notNull(),
    priceAfterInr: numeric("price_after_inr", { precision: 18, scale: 4 }).notNull(),
    rawRatio: numeric("raw_ratio", { precision: 14, scale: 6 }).notNull(),
    matchedRatio: numeric("matched_ratio", { precision: 14, scale: 6 }).notNull(),
    deviationPct: numeric("deviation_pct", { precision: 8, scale: 5 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("isin_share_adjustment_log_isin_period_date_idx").on(t.isin, t.reportPeriod, t.detectedOn)]
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

// Gold/Silver ETF scheme registry -- one row per scheme, ever. Deliberately
// independent of DHAN/instrumentMap: sourced from AMFI's own public records
// via a free third-party reformatting API (api.tigzig.com/mf/v1), not DHAN's
// instrument master, so this feature carries none of DHAN's daily-token
// operational burden.
export const etfSchemes = pgTable(
  "etf_schemes",
  {
    id: serial("id").primaryKey(),
    schemeCode: integer("scheme_code").notNull(), // AMFI/TigZig numeric scheme code
    isin: text("isin"), // nullable -- a brand-new scheme can lack one for a few weeks
    name: text("name").notNull(),
    amc: text("amc").notNull(), // matches amcs.overviewName where that AMC also runs an equity scheme tracked in Overview
    assetClass: text("asset_class").notNull(), // 'gold' | 'silver'
    slug: text("slug").notNull(),
  },
  (t) => [uniqueIndex("etf_schemes_scheme_code_idx").on(t.schemeCode), uniqueIndex("etf_schemes_slug_idx").on(t.slug)]
);

// Per-quarter reported AUM baseline for an ETF scheme, captured from
// TigZig's "latest quarterly AAUM" snapshot the moment a new quarter first
// appears there. Unique on (schemeId, reportPeriod) so re-running the
// ingestion mid-quarter is a harmless upsert -- same shape as amcPeriods.
// navAtPeriodEnd is this scheme's own NAV at capture time, the denominator
// for the live-AUM price ratio.
export const etfPeriodAum = pgTable(
  "etf_period_aum",
  {
    id: serial("id").primaryKey(),
    schemeId: integer("scheme_id")
      .notNull()
      .references(() => etfSchemes.id, { onDelete: "cascade" }),
    reportPeriod: text("report_period").notNull(), // TigZig's own label, e.g. "June-2026"
    reportedAumCr: numeric("reported_aum_cr", { precision: 18, scale: 4 }).notNull(),
    navAtPeriodEnd: numeric("nav_at_period_end", { precision: 18, scale: 4 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("etf_period_aum_scheme_period_idx").on(t.schemeId, t.reportPeriod)]
);

// Daily NAV per ETF scheme -- this feature's own price history, entirely
// separate from isinDailyPrice (DHAN-keyed), sourced from the same TigZig
// API as the AUM baseline above. Unique on (schemeId, snapshotDate),
// overwritten intraday the same way isinDailyPrice is.
export const etfDailyNav = pgTable(
  "etf_daily_nav",
  {
    id: serial("id").primaryKey(),
    schemeId: integer("scheme_id")
      .notNull()
      .references(() => etfSchemes.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    nav: numeric("nav", { precision: 18, scale: 4 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("etf_daily_nav_scheme_date_idx").on(t.schemeId, t.snapshotDate)]
);
