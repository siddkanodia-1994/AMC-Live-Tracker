"use client";

import "./amc-analytics.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import { useAmcAnalyticsInputs } from "@/hooks/use-amc-analytics-inputs";
import { useLiveCorrelationEntries } from "@/hooks/use-amc-live-prices";
import { previousClose } from "@/lib/amc-stock/live-point";
import { formatLedgerPct } from "@/lib/aum/period-ledger";
import { useActiveGoldSilverBlendAmcIds } from "@/components/layout/gold-silver-blend-context";
import { ACCORD_CODES } from "@/lib/valuation/parse-valuation-workbook";
import { buildPeriodLedger, LEDGER_WEEKDAYS, type LedgerWeekday, type PeriodLedger } from "@/lib/aum/period-ledger";
import { toLedgerPoints } from "@/lib/aum/period-ledger-rows";
import type { LiveAumSnapshot } from "@/lib/aum/types";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import { AumSummaryLedger, type LedgerSelectKey, type LedgerSelections } from "./aum-summary-ledger";
import { AumPredictorSection, LivePredictorSection, RatioSection, RegressionSection, useFitControls, ValuationModelSection } from "./sections";
import { SipScoreSection } from "./sip-score-section";
import { IndustrySipView } from "./industry-sip-view";
import { useIndustryMonthlyFlows } from "@/hooks/use-industry-monthly-flows";
import { monthKey, monthLabel } from "@/lib/aum/industry-sip";

// The ledger design system's typefaces, loaded for this tab only (the
// variables are read by amc-analytics.css's --pl-font-* tokens).
const plexSans = IBM_Plex_Sans({ variable: "--font-ibm-plex-sans", weight: ["400", "500", "600", "700"], subsets: ["latin"] });
const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-ibm-plex-condensed",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

// Tab order and short tab labels for the 8 listed AMCs.
const AMC_TABS: { slug: string; tab: string }[] = [
  { slug: "hdfc-mutual-fund", tab: "HDFC" },
  { slug: "icici-prudential-mutual-fund", tab: "ICICI Pru" },
  { slug: "sbi-mutual-fund", tab: "SBI" },
  { slug: "nippon-india-mutual-fund", tab: "Nippon" },
  { slug: "aditya-birla-sun-life-mutual-fund", tab: "ABSL" },
  { slug: "uti-mutual-fund", tab: "UTI" },
  { slug: "canara-robeco-mutual-fund", tab: "Canara Robeco" },
  { slug: "motilal-oswal-mutual-fund", tab: "Motilal" },
];

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  return res.json();
}

const COMPANY_BY_SLUG =new Map(Object.values(ACCORD_CODES).map((v) => [v.slug, v.company]));

export type AmcAnalyticsSection = "summary" | "sip-score" | "industry-sip" | "aum-predictor" | "ratio" | "regression" | "valuation";

const SECTIONS: { key: AmcAnalyticsSection; label: string; icon: ReactNode }[] = [
  {
    key: "summary",
    label: "AUM Summary",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" />
        <path d="M3 9h18M3 14h18M9 4v16" />
      </svg>
    ),
  },
  {
    key: "sip-score",
    label: "SIP & Score",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20V14M10 20V9M16 20V12M22 20H2" />
        <path d="M4 10l6-5 6 4 5-4" />
      </svg>
    ),
  },
  {
    key: "industry-sip",
    label: "Industry SIP",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 20h18M5 20V10M10 20V6M15 20v-8M20 20V4" />
      </svg>
    ),
  },
  {
    key: "aum-predictor",
    label: "AUM Predictor",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12h4l3-7 4 14 3-7h6" />
      </svg>
    ),
  },
  {
    key: "ratio",
    label: "Ratio",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 5L5 19" />
        <circle cx="7" cy="7" r="2.5" />
        <circle cx="17" cy="17" r="2.5" />
      </svg>
    ),
  },
  {
    key: "regression",
    label: "Regression",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
      </svg>
    ),
  },
  {
    key: "valuation",
    label: "Valuation Model",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      </svg>
    ),
  },
];

function defaultSelections(model: PeriodLedger): LedgerSelections {
  const d = model.defaults();
  const wq = {} as Record<LedgerWeekday, string[]>;
  for (const day of LEDGER_WEEKDAYS) wq[day] = [...d.wq];
  return { fy: [...d.fy], q: [...d.q], m: [...d.m], wq };
}

// Keep the user's picks across AMC tabs / data refreshes, but fall back to
// the defaults for any label the current data doesn't have.
function reconcileSelections(prev: LedgerSelections | null, model: PeriodLedger): LedgerSelections {
  const fresh = defaultSelections(model);
  if (!prev) return fresh;
  // One row per default, so a newly added row (e.g. the third Month row) appears.
  const keep = (list: string[], picked: string[], dflt: string[]) => dflt.map((d, i) => (picked[i] !== undefined && list.includes(picked[i]) ? picked[i] : d));
  const wq = {} as Record<LedgerWeekday, string[]>;
  for (const day of LEDGER_WEEKDAYS) wq[day] = keep(model.quarters, prev.wq[day], fresh.wq[day]);
  return {
    fy: keep(model.fys, prev.fy, fresh.fy),
    q: keep(model.quarters, prev.q, fresh.q),
    m: keep(model.months, prev.m, fresh.m),
    wq,
  };
}

function istStamp(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  return `${day} · ${time} IST`;
}

// The AMC tab's second line: today's price and its change on the last
// close; the last stored close when there's no price for today yet.
function TabPrice({ entry, price, date }: { entry: AmcStockCorrelationEntry | undefined; price: number | undefined; date: string | undefined }) {
  const series = entry?.stockPriceSeries ?? [];
  const today = price !== undefined && date !== undefined;
  const shown = today ? price : series.at(-1)?.priceInr;
  if (shown === undefined) return null;
  const base = previousClose(series, today ? date : (series.at(-1)?.date ?? ""));
  const chg = formatLedgerPct(base ? shown / base - 1 : null);
  return (
    <span className="pl-tab-px">
      ₹{shown.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {chg && <span className={`pl-tab-chg pl-tab-chg--${chg.tone}`}>{chg.text}</span>}
    </span>
  );
}

export function AmcAnalytics({ liveAum }: { liveAum?: LiveAumSnapshot }) {
  const { data, error, isLoading } = useAmcStockCorrelations();
  const blendIds = useActiveGoldSilverBlendAmcIds();
  const [section, setSection] = useState<AmcAnalyticsSection>("summary");
  const [slug, setSlug] = useState(AMC_TABS[0].slug);
  // AMFI's industry-wide SIP: not about one AMC, so the AMC tabs hide.
  const isIndustry = section === "industry-sip";
  const { data: flows } = useIndustryMonthlyFlows();
  const latestFlow = flows?.points.length ? flows.points.reduce((a, b) => (a.monthEndDate > b.monthEndDate ? a : b)) : undefined;
  const [selections, setSelections] = useState<LedgerSelections | null>(null);
  const fitControls = useFitControls(data?.defaults);
  // Section menu folds to a slim icon rail; opens every visit (user's choice).
  const [navCollapsed, setNavCollapsed] = useState(false);

  // Same SWR key the Gold/Silver blend context already fetches, so no extra request.
  const { data: listed } = useSWR<{ amcs: { id: number; slug: string }[] }>("/api/listed-amcs", fetchJson, { revalidateOnFocus: false });
  const amcIdBySlug = useMemo(() => new Map((listed?.amcs ?? []).map((a) => [a.slug, a.id])), [listed]);
  const amcId = amcIdBySlug.get(slug) ?? null;
  const blended = amcId !== null && blendIds.includes(amcId);
  // The valuation and SIP figures it shares with the Fortnightly tab (one AMC, one stored row).
  const { data: inputs } = useAmcAnalyticsInputs(amcId);
  // Today's live share price (and live AUM) laid over every AMC's history,
  // so all sections' charts, ratios, fits, targets and upsides follow it.
  const { entries: liveEntries, points: livePoints, prices: livePrices } = useLiveCorrelationEntries(data?.amcs, liveAum);

  const tabs = useMemo(() => {
    const have = new Set((data?.amcs ?? []).map((a) => a.slug));
    return AMC_TABS.filter((t) => have.has(t.slug));
  }, [data]);

  const model = useMemo(() => {
    const entry = liveEntries?.find((a) => a.slug === slug);
    return entry ? buildPeriodLedger(toLedgerPoints(entry.aumHistory)) : null;
  }, [liveEntries, slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-validate the shared picks against the newly built model
    if (model) setSelections((prev) => reconcileSelections(prev, model));
  }, [model]);

  const onSelect = (key: LedgerSelectKey, label: string) => {
    setSelections((prev) => {
      if (!prev) return prev;
      if (key.kind === "wq") {
        const rows = [...prev.wq[key.day]];
        rows[key.row] = label;
        return { ...prev, wq: { ...prev.wq, [key.day]: rows } };
      }
      const rows = [...prev[key.kind]];
      rows[key.row] = label;
      return { ...prev, [key.kind]: rows };
    });
  };

  const entry = liveEntries?.find((a) => a.slug === slug);
  // CMP: today's live price when there is one (after 15:30, the session's
  // last price), else the last stored close the Overview prices come from.
  const livePoint = livePoints.get(slug);
  const lastClose = data?.amcs.find((a) => a.slug === slug)?.stockPriceSeries.at(-1)?.priceInr ?? null;
  const cmpInr = livePoint?.priceInr ?? lastClose;
  const cmpIsLive = livePoint !== undefined && Boolean(livePrices?.marketOpen);
  const amcOptions = tabs.map((t) => ({ slug: t.slug, label: COMPANY_BY_SLUG.get(t.slug) ?? t.tab }));
  const live = liveAum?.amcs.find((a) => a.slug === slug);
  const tabLabel = tabs.find((t) => t.slug === slug)?.tab ?? "";
  const company = COMPANY_BY_SLUG.get(slug) ?? data?.amcs.find((a) => a.slug === slug)?.overviewName ?? "";
  const aumKind = blended ? "Equity + Gold/Silver AUM" : "Equity AUM";
  const aumKindInline = blended ? "equity + gold/silver AUM" : "equity AUM";
  const tradingSymbol = data?.amcs.find((a) => a.slug === slug)?.tradingSymbol;
  const lastDate = model?.months.length ? data?.amcs.find((a) => a.slug === slug)?.aumHistory.at(-1)?.date : undefined;
  const active = SECTIONS.find((s) => s.key === section)!;

  return (
    <div className={`aa ${plexSans.variable} ${plexCondensed.variable}${navCollapsed ? " is-nav-rail" : ""}`}>
      <aside className="aa-side" id="aa-side">
        <div className="aa-brand">
          <span className="aa-brand-mark" aria-hidden="true">
            A
          </span>
          <div className="aa-brand-text">
            <span className="aa-brand-title">AMC ANALYTICS</span>
            <span className="aa-brand-sub">EQUITY AUM INTELLIGENCE</span>
          </div>
          <button
            type="button"
            className="aa-collapse"
            aria-controls="aa-side"
            aria-expanded={!navCollapsed}
            aria-label={navCollapsed ? "Show the section menu" : "Hide the section menu"}
            title={navCollapsed ? "Show menu" : "Hide menu"}
            onClick={() => setNavCollapsed((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={navCollapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
            </svg>
          </button>
        </div>
        <nav aria-label="AMC Analytics sections">
          <ul className="aa-nav">
            {SECTIONS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="aa-nav-btn"
                  aria-current={s.key === section ? "page" : undefined}
                  title={navCollapsed ? s.label : undefined}
                  onClick={() => setSection(s.key)}
                >
                  {s.icon}
                  <span className="aa-nav-label">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="aa-main">
        <div className="aa-strip">
          {isIndustry ? (
            <>
              <span className="aa-strip-label">Latest industry SIP</span>
              {latestFlow && (
                <span className="aa-chip">
                  <span className="aa-chip-key">AMFI</span>
                  <span className="aa-chip-val">₹{Math.round(latestFlow.sipContributionsCr).toLocaleString("en-IN")} Cr</span>
                  <span className="aa-chip-note">{monthLabel(monthKey(latestFlow.monthEndDate))}</span>
                </span>
              )}
            </>
          ) : (
            <>
              <span className="aa-strip-label">Today&apos;s {aumKindInline}</span>
              {live && (
                <span className="aa-chip">
                  <span className="aa-chip-key">{tabLabel.toUpperCase()}</span>
                  <span className="aa-chip-val">₹{Math.round(live.liveAumCr).toLocaleString("en-IN")} Cr</span>
                  <span className="aa-chip-note">{istStamp(liveAum?.computedAt)}</span>
                </span>
              )}
              {cmpInr != null && (
                <span className="aa-chip">
                  <span className="aa-chip-key">{tradingSymbol}</span>
                  <span className="aa-chip-val">₹{cmpInr.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  {cmpIsLive ? <span className="aa-live">LIVE</span> : <span className="aa-chip-note">{livePoint ? "close" : "last close"}</span>}
                </span>
              )}
            </>
          )}
        </div>
        <h2 className="aa-title">{active.label}</h2>
        <div className="aa-body">
          {error ? (
            <p className="aa-note">Could not load the AUM history: {error.message}</p>
          ) : isLoading && !data ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <div className="pl-ledger">
              <div className="pl-tabs" role="tablist" aria-label="AMC" hidden={isIndustry}>
                {tabs.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    role="tab"
                    aria-selected={t.slug === slug}
                    tabIndex={t.slug === slug ? 0 : -1}
                    className={`pl-tab${t.slug === slug ? " is-active" : ""}`}
                    onClick={() => setSlug(t.slug)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                      const i = tabs.findIndex((x) => x.slug === slug) + (e.key === "ArrowRight" ? 1 : -1);
                      const next = tabs[(i + tabs.length) % tabs.length];
                      setSlug(next.slug);
                      (e.currentTarget.parentElement?.children[(i + tabs.length) % tabs.length] as HTMLElement | undefined)?.focus();
                      e.preventDefault();
                    }}
                  >
                    {t.tab}
                    <TabPrice entry={data?.amcs.find((a) => a.slug === t.slug)} price={livePoints.get(t.slug)?.priceInr} date={livePrices?.date} />
                  </button>
                ))}
              </div>

              {isIndustry ? (
                <IndustrySipView points={flows?.points} />
              ) : section === "summary" ? (
                model && selections ? (
                  <>
                    <AumSummaryLedger
                      model={model}
                      title={`${company} ${aumKind}`}
                      unitLine={`₹ Cr · daily avg · ${aumKindInline}`}
                      selections={selections}
                      onSelect={onSelect}
                    />
                    <p className="aa-note">
                      Every figure is the average daily {aumKindInline} over the window (sum of daily values ÷ trading
                      days){lastDate ? `, data to ${lastDate}` : ""}. Before 1 Jan 2026, AUM is modelled from month-end anchors.
                      Muhurat and DR test sessions are left out.
                    </p>
                  </>
                ) : (
                  <p className="aa-note">No AUM history for this AMC.</p>
                )
              ) : section === "sip-score" ? (
                <SipScoreSection slug={slug} inputs={inputs} />
              ) : section === "aum-predictor" ? (
                // The what-if, then today's live AUM through the same line.
                <div className="aa-stack">
                  <AumPredictorSection entry={entry} defaults={data?.defaults} priceIsLive={cmpIsLive} />
                  <LivePredictorSection
                    entry={entry}
                    defaults={data?.defaults}
                    liveAumCr={live?.liveAumCr ?? null}
                    cmpInr={cmpInr}
                    cmpIsLive={cmpIsLive}
                  />
                </div>
              ) : section === "ratio" ? (
                <RatioSection
                  entry={entry}
                  defaults={data?.defaults}
                  controls={fitControls}
                  cmpInr={cmpInr}
                  cmpIsLive={cmpIsLive}
                />
              ) : section === "regression" ? (
                <RegressionSection entry={entry} defaults={data?.defaults} controls={fitControls} />
              ) : (
                <ValuationModelSection
                  slug={slug}
                  entry={entry}
                  defaults={data?.defaults}
                  inputs={inputs}
                  cmpInr={cmpInr}
                  cmpIsLive={cmpIsLive}
                  amcOptions={amcOptions}
                  onSlugChange={setSlug}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
