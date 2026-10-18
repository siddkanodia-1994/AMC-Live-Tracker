"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { mutate } from "swr";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EditNumberCell } from "./edit-number-cell";
import { EditTextareaCell } from "./edit-textarea-cell";
import { FortnightlyDownloadPanel } from "./fortnightly-download-panel";
import { useFlowEstimateDisplay } from "@/components/layout/flow-estimate-context";
import { useFortnightlyEligibleAmcs, useFortnightlySheet } from "@/hooks/use-fortnightly-update";
import { formatPct, formatPriceInr, formatShortDate } from "@/lib/utils/format";
import {
  VERDICT_TIERS,
  parseSummaryRows,
  type FortnightlyFieldName,
  type FortnightlySheet,
  type ScenarioValues,
  type VerdictThresholds,
  type VerdictTier,
} from "@/lib/aum/fortnightly-update";

const selectClass =
  "min-w-0 max-w-[260px] rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

// Picked from the style preview Artifact (d7ecff fill / a9d2f2 border) --
// applied to every editable/dropdown cell INSIDE the sheet (manual number
// cells, the Quarter/FY and Month/Year pickers), not the AMC/As-of
// navigation selects above the sheet, which stay their plain neutral style.
const INPUT_CELL_CLASS = "bg-[#d7ecff] border-[#a9d2f2] text-[#0b2338]";

const inlineSelectClass = `rounded-md border px-2 py-1 hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40 ${INPUT_CELL_CLASS}`;

// "Comfortable" type scale from the style preview, applied to every <Table>
// in this tab (overrides shadcn's own text-sm default via tailwind-merge).
const TABLE_TEXT_CLASS = "text-[15px]";

// "High contrast" font shade from the style preview, replacing this tab's
// own text-muted-foreground usages (labels, captions, column headers) --
// hardcoded at each call site below rather than referencing this constant,
// matching the file's existing convention of inlining Tailwind classes.

// A wide net around whatever quarter/FY is currently selected (not "today"
// -- a past frozen snapshot's own selection may be years away from today's
// calendar quarter, and the dropdown must always include it) so the
// analyst can move the anchor forward or back without the option simply
// not existing.
function fyOptionsAround(selectedFy: number): number[] {
  const options: number[] = [];
  for (let fy = selectedFy - 10; fy <= selectedFy + 5; fy++) options.push(fy);
  return options;
}

// Same "wide net around whatever's currently selected" rationale as
// fyOptionsAround, for the SIP Industry Growth month picker.
function yearOptionsAround(selectedYear: number): number[] {
  const options: number[] = [];
  for (let y = selectedYear - 10; y <= selectedYear + 5; y++) options.push(y);
  return options;
}

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function numOrZero(v: number | null): number {
  return v ?? 0;
}

// Every cached Fortnightly sheet (not just the one currently being
// viewed) needs to pick up a change to either SIP Industry global setting
// below, since both affect all 8 AMCs' cards at once.
function revalidateAllFortnightlySheets() {
  return mutate((key) => typeof key === "string" && key.startsWith("/api/fortnightly-update?"), undefined, { revalidate: true });
}

// Saves the SIP Industry cards' single GLOBAL "latest available month"
// anchor directly (used by the Monthly card's own Month/Year pickers --
// industry-wide data, identical for every AMC, not a per-AMC field like
// this tab's other manual values; see
// src/lib/aum/fortnightly-update.ts's getSipIndustryAnchorOverride).
function saveSipIndustryAnchorMonth(month: string) {
  fetch("/api/sip-industry-override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      await revalidateAllFortnightlySheets();
    })
    .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to save SIP Industry anchor"));
}

// Saves the same global anchor from the Quarterly card's own Quarter/FY
// pickers -- resolved server-side to the last REAL AMFI month inside that
// quarter (see getLastRealMonthInQuarter), not a naive first-of-quarter
// guess, since a quarter with no real data yet (e.g. one that hasn't
// started reporting) has nothing to anchor to.
function saveSipIndustryQuarterAnchor(quarterFy: number, quarter: number) {
  fetch("/api/sip-industry-override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quarterFy, quarter }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      await revalidateAllFortnightlySheets();
    })
    .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to save SIP Industry anchor"));
}

// Saves the SIP Industry cards' single GLOBAL "show estimated next period"
// toggle (see src/lib/aum/fortnightly-update.ts's getSipIndustryShowEstimate).
function saveSipIndustryShowEstimate(enabled: boolean) {
  fetch("/api/sip-industry-estimate-toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      await revalidateAllFortnightlySheets();
    })
    .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to save estimate toggle"));
}

// Saves the Overview card's single GLOBAL 5-tier verdict thresholds (see
// src/lib/aum/fortnightly-update.ts's getVerdictThresholds) -- applies to
// every AMC's auto-suggested verdict at once, same global-setting
// invalidation pattern as the SIP Industry toggles above.
function saveVerdictThresholds(thresholds: VerdictThresholds) {
  fetch("/api/verdict-thresholds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(thresholds),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      await revalidateAllFortnightlySheets();
    })
    .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to save verdict thresholds"));
}

// Whole crores, no decimals -- scoped to just this tab (per user request),
// NOT the shared formatCr() used everywhere else in the app (same
// precedent as summary-panel.tsx's own local formatCrRounded).
function formatCrRounded(valueCr: number): string {
  return `₹${Math.round(valueCr).toLocaleString("en-IN")} cr`;
}

// "30 Sept 26" -- matches the "tusk-amc-dashboard" benchmarking Scores
// page's own Anchor Date picker exactly (confirmed against a screenshot),
// for the AMC Score card's picker below. en-IN's "short" month already
// renders September as "Sept" (not "Sep"), same as that reference.
function formatAnchorDateOption(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

// A thin label/value row for sections that aren't naturally a multi-column
// table (header stats, PAT/CAGR) -- plain two-cell rows, same visual
// language as the valuation/QAAUM tables below.
function LabelRow({ label, children, bold }: { label: string; children: React.ReactNode; bold?: boolean }) {
  return (
    <TableRow>
      <TableCell className={bold ? "font-semibold" : undefined}>{label}</TableCell>
      {children}
    </TableRow>
  );
}

// Same Excel-style cell-fill colours as the Summary tab's own PctCell
// (summary-panel.tsx) -- #C6EFCE/#006100 positive, #FFC7CE/#9C0006
// negative in light mode, adapted darker/desaturated tones in dark mode.
// Kept in sync with that file's copy rather than shared, same precedent
// as that file's own "local copy of small pure helpers" convention.
function PctCell({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <TableCell className={`text-right tabular-nums text-[#262626] dark:text-[#d4d4d4] ${className ?? ""}`}>—</TableCell>;
  const positive = value >= 0;
  return (
    <TableCell
      className={`text-right tabular-nums font-semibold ${
        positive
          ? "bg-[#C6EFCE] text-[#006100] dark:bg-[#0d3b2b] dark:text-[#6ee7b7]"
          : "bg-[#FFC7CE] text-[#9C0006] dark:bg-[#4c1113] dark:text-[#fca5a5]"
      } ${className ?? ""}`}
    >
      {formatPct(value, { alwaysSign: true })}
    </TableCell>
  );
}

// SIP/Equity AUM is a LEVEL (always positive), not a growth rate, so
// PctCell's sign-based green/red can't apply to it -- instead every row
// across the whole 5-period set is colored on a continuous gradient: the
// LOWEST value gets full red, the HIGHEST gets full green, everything
// else gets the proportional in-between shade (confirmed with the user: a
// 2-stop DIRECT red-to-green blend, not a 3-stop red-yellow-green scale).
// Reuses this app's own existing green/red tint pair (PctCell's hex
// values) as the two endpoints for visual consistency with every other
// green/red indicator already in the app. Returns undefined (falls back
// to the default blue manual-input style) when fewer than 2 distinct
// values exist to form a range from.
const SIP_GRADIENT_RED: [number, number, number] = [255, 199, 206]; // #FFC7CE
const SIP_GRADIENT_RED_TEXT: [number, number, number] = [156, 0, 6]; // #9C0006
const SIP_GRADIENT_GREEN: [number, number, number] = [198, 239, 206]; // #C6EFCE
const SIP_GRADIENT_GREEN_TEXT: [number, number, number] = [0, 97, 0]; // #006100

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

function sipEquityAumGradientStyle(pct: number | null, allPcts: (number | null)[]): CSSProperties | undefined {
  if (pct === null) return undefined;
  const values = allPcts.filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (values.length < 2 || min === max) return undefined;
  const t = (pct - min) / (max - min);
  const bg = [
    lerpChannel(SIP_GRADIENT_RED[0], SIP_GRADIENT_GREEN[0], t),
    lerpChannel(SIP_GRADIENT_RED[1], SIP_GRADIENT_GREEN[1], t),
    lerpChannel(SIP_GRADIENT_RED[2], SIP_GRADIENT_GREEN[2], t),
  ];
  const fg = [
    lerpChannel(SIP_GRADIENT_RED_TEXT[0], SIP_GRADIENT_GREEN_TEXT[0], t),
    lerpChannel(SIP_GRADIENT_RED_TEXT[1], SIP_GRADIENT_GREEN_TEXT[1], t),
    lerpChannel(SIP_GRADIENT_RED_TEXT[2], SIP_GRADIENT_GREEN_TEXT[2], t),
  ];
  return { backgroundColor: `rgb(${bg.join(",")})`, color: `rgb(${fg.join(",")})` };
}

function PriceCell({ value }: { value: number | null }) {
  return <TableCell className="text-right tabular-nums font-semibold">{value === null ? "—" : formatPriceInr(value)}</TableCell>;
}

// Solid banner-bar section title, matching the Summary tab's own
// TwoRowBanner/BannerRow convention -- a full-width TableRow living INSIDE
// the Table (not a <div> sibling above it), so every card's title reads
// the same as "Financial Year"/"Quarter>>" do there.
function SectionBanner({ title, colSpan }: { title: string; colSpan: number }) {
  return (
    <TableRow className="bg-foreground hover:bg-foreground">
      <TableCell colSpan={colSpan} className="font-semibold text-background">
        {title}
      </TableCell>
    </TableRow>
  );
}

export function FortnightlyUpdatePanel() {
  const { data: amcsData, isLoading: amcsLoading } = useFortnightlyEligibleAmcs();
  const [amcId, setAmcId] = useState<number | null>(null);
  const [asOfDate, setAsOfDate] = useState<string | null>(null); // null = latest
  const [creating, setCreating] = useState(false);
  const [newDateInput, setNewDateInput] = useState("");

  useEffect(() => {
    if (amcId === null && amcsData && amcsData.amcs.length > 0) {
      setAmcId(amcsData.amcs[0].amcId);
    }
  }, [amcId, amcsData]);

  const { includeFlowEstimate } = useFlowEstimateDisplay();
  const { data: sheet, error, isLoading, mutate } = useFortnightlySheet(amcId, asOfDate, includeFlowEstimate);

  // Reset the date selector back to "latest" whenever the AMC changes, so
  // switching AMCs never silently carries over a date that may not exist
  // for the newly-selected one.
  function handleAmcChange(newAmcId: number) {
    setAmcId(newAmcId);
    setAsOfDate(null);
  }

  async function saveField(field: FortnightlyFieldName, value: number | string | null) {
    if (!sheet) return;
    const res = await fetch("/api/fortnightly-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amcId: sheet.amcId, asOfDate: sheet.asOfDate, field, value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to save");
    }
    await mutate();
  }

  async function handleCreateSnapshot() {
    if (amcId === null) return;
    setCreating(true);
    try {
      const res = await fetch("/api/fortnightly-update/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amcId, asOfDate: newDateInput || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create snapshot");
      }
      const result = await res.json();
      setAsOfDate(result.asOfDate);
      setNewDateInput("");
      await mutate();
      toast.success(`New fortnightly update created for ${result.asOfDate}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create snapshot");
    } finally {
      setCreating(false);
    }
  }

  if (amcsLoading || (isLoading && !sheet)) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (error) {
    return <p className="text-center text-[#262626] dark:text-[#d4d4d4]">Failed to load: {error.message}</p>;
  }

  if (!amcsData || amcsData.amcs.length === 0) {
    return <p className="text-center text-sm text-[#262626] dark:text-[#d4d4d4]">No listed-stock AMCs configured yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="fortnightly-amc" className="text-xs text-[#262626] dark:text-[#d4d4d4]">
            AMC
          </label>
          <select
            id="fortnightly-amc"
            value={amcId ?? ""}
            onChange={(e) => handleAmcChange(Number(e.target.value))}
            className={selectClass}
          >
            {amcsData.amcs.map((a) => (
              <option key={a.amcId} value={a.amcId}>
                {a.overviewName}
              </option>
            ))}
          </select>
        </div>
        {sheet && (
          <div className="flex flex-col gap-1">
            <label htmlFor="fortnightly-date" className="text-xs text-[#262626] dark:text-[#d4d4d4]">
              As of
            </label>
            <select
              id="fortnightly-date"
              value={sheet.asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className={selectClass}
            >
              {sheet.availableDates.length === 0 && <option value={sheet.asOfDate}>{formatShortDate(sheet.asOfDate)} (unsaved)</option>}
              {sheet.availableDates.map((d) => (
                <option key={d} value={d}>
                  {formatShortDate(d)}
                  {d === sheet.availableDates[0] ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input
            type="date"
            value={newDateInput}
            onChange={(e) => setNewDateInput(e.target.value)}
            title="Leave blank for today"
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={handleCreateSnapshot}
            disabled={creating}
            className="rounded-md border bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Creating…" : "+ New fortnightly update"}
          </button>
        </div>
        {sheet && !sheet.isLatest && (
          <span className="ml-auto rounded-sm border border-amber-500/60 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
            Viewing a past snapshot ({formatShortDate(sheet.asOfDate)})
          </span>
        )}
      </div>

      {sheet && <FortnightlySheetView sheet={sheet} onSave={saveField} />}

      <FortnightlyDownloadPanel />
    </div>
  );
}

function ManualCell({
  value,
  onSave,
  title,
  decimals,
  suffix,
  inputClassName,
  inputStyle,
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  title?: string;
  decimals?: number;
  suffix?: string;
  // Lets a specific call site theme the input's background (e.g. the SIP
  // AMC Growth card's conditional coloring on "SIP/Equity AUM") without
  // affecting every other ManualCell in the app; defaults to the usual
  // blue manual-input fill.
  inputClassName?: string;
  // Continuously-computed color (e.g. the SIP/Equity AUM gradient) that
  // can't be expressed as a static Tailwind class -- see EditNumberCell's
  // own inputStyle doc-comment.
  inputStyle?: CSSProperties;
}) {
  return (
    <EditNumberCell
      value={numOrZero(value)}
      isOverridden={value !== null}
      onSave={onSave}
      title={title}
      decimals={decimals}
      inputClassName={inputClassName ?? INPUT_CELL_CLASS}
      inputStyle={inputStyle}
      suffix={suffix}
    />
  );
}

// Like ManualCell, but with an auto-pulled default: shows the manual
// override when one has been entered, otherwise falls back to a live value
// pulled from elsewhere in the dashboard. "Overridden" (amber border, reset
// button) reflects whether a MANUAL value is on file, not whether the
// effective value differs from the auto default.
function ManualOrAutoCell({
  manualValue,
  autoValue,
  onSave,
  title,
  decimals,
}: {
  manualValue: number | null;
  autoValue: number | null;
  onSave: (v: number | null) => Promise<void>;
  title?: string;
  decimals?: number;
}) {
  const effective = manualValue ?? autoValue;
  return (
    <EditNumberCell
      value={numOrZero(effective)}
      isOverridden={manualValue !== null}
      onSave={onSave}
      title={title}
      decimals={decimals}
      inputClassName={INPUT_CELL_CLASS}
    />
  );
}

function ScenarioHeaderRow() {
  return (
    <TableRow>
      <TableCell />
      <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Bear</TableCell>
      <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Base</TableCell>
      <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Bull</TableCell>
    </TableRow>
  );
}

function ScenarioPriceRow({ label, values, bold }: { label: string; values: ScenarioValues; bold?: boolean }) {
  return (
    <TableRow>
      <TableCell className={bold ? "font-semibold" : undefined}>{label}</TableCell>
      <PriceCell value={values.bear} />
      <PriceCell value={values.base} />
      <PriceCell value={values.bull} />
    </TableRow>
  );
}

function ScenarioPctRow({ label, values }: { label: string; values: ScenarioValues }) {
  return (
    <TableRow>
      <TableCell className="text-[#262626] dark:text-[#d4d4d4]">{label}</TableCell>
      <PctCell value={values.bear} />
      <PctCell value={values.base} />
      <PctCell value={values.bull} />
    </TableRow>
  );
}

function ScenarioMcapRow({ label, values }: { label: string; values: ScenarioValues }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right tabular-nums">{values.bear === null ? "—" : formatCrRounded(values.bear)}</TableCell>
      <TableCell className="text-right tabular-nums">{values.base === null ? "—" : formatCrRounded(values.base)}</TableCell>
      <TableCell className="text-right tabular-nums">{values.bull === null ? "—" : formatCrRounded(values.bull)}</TableCell>
    </TableRow>
  );
}

function ScenarioEditRow({
  label,
  bear,
  base,
  bull,
  onSave,
  title,
}: {
  label: string;
  bear: number | null;
  base: number | null;
  bull: number | null;
  onSave: (field: FortnightlyFieldName, v: number | null) => Promise<void>;
  title: string;
}) {
  return (
    <TableRow>
      <TableCell className="font-semibold">{label}</TableCell>
      <ManualCell value={bear} onSave={(v) => onSave("targetPeBear", v)} title={title} />
      <ManualCell value={base} onSave={(v) => onSave("targetPeBase", v)} title={title} />
      <ManualCell value={bull} onSave={(v) => onSave("targetPeBull", v)} title={title} />
    </TableRow>
  );
}

// Deterministic (no AI/LLM call) draft for the Overview card's writeup --
// string-interpolates this AMC's own already-computed figures from every
// other card into a short bulleted summary. Only ever runs when the
// analyst explicitly clicks "Regenerate from data" -- never auto-fills or
// silently overwrites whatever's already in the box.
function generateOverviewDraft(sheet: FortnightlySheet): string {
  const m = sheet.manual;
  const bullets: string[] = [];

  // QAAUM: both the latest quarter AND the previous quarter get their own
  // Val/QoQ/YoY line -- sheet.qaaum[1] (the prior quarter) already carries
  // its own qoqPct/yoyPct (vs. its own prior quarter / year-ago quarter),
  // same shape as qaaum[0], no new computation needed. The 2nd line has NO
  // "•" prefix -- parseSummaryRows (fortnightly-update.ts) treats a
  // non-bulleted line as a continuation of the preceding bullet, folding
  // it into the SAME row's detail (shown as a 2nd line within one table
  // cell in the live/PDF/Excel views) rather than a separate bullet.
  const formatQuarterLine = (q: FortnightlySheet["qaaum"][number]) =>
    `${q.valCr === null ? "—" : formatCrRounded(q.valCr)} in ${q.label}, ` +
    `${q.qoqPct == null ? "—" : formatPct(q.qoqPct, { alwaysSign: true })} QoQ, ` +
    `${q.yoyPct == null ? "—" : formatPct(q.yoyPct, { alwaysSign: true })} YoY`;
  const qaaumLatest = sheet.qaaum[0];
  const qaaumPrev = sheet.qaaum[1];
  if (qaaumLatest) {
    bullets.push(`• QAAUM: ${formatQuarterLine(qaaumLatest)}` + (qaaumPrev ? `\n${formatQuarterLine(qaaumPrev)}` : ""));
  }

  const sipQoq =
    m.sipAmcPrevQValCr !== null && m.sipAmcQtdValCr !== null && m.sipAmcPrevQValCr !== 0 ? m.sipAmcQtdValCr / m.sipAmcPrevQValCr - 1 : null;
  const sipYoy =
    m.sipAmcYoyQValCr !== null && m.sipAmcQtdValCr !== null && m.sipAmcYoyQValCr !== 0 ? m.sipAmcQtdValCr / m.sipAmcYoyQValCr - 1 : null;
  bullets.push(
    `• SIP flows: ${m.sipAmcQtdValCr === null ? "—" : formatCrRounded(m.sipAmcQtdValCr)} in ${sheet.sipAmcLabels.qtd}, ` +
      `${sipQoq === null ? "—" : formatPct(sipQoq, { alwaysSign: true })} QoQ, ` +
      `${sipYoy === null ? "—" : formatPct(sipYoy, { alwaysSign: true })} YoY — SIP/Equity AUM at ` +
      `${m.sipAmcQtdPct === null ? "—" : formatPct(m.sipAmcQtdPct)} ` +
      `(${m.sipAmcPrevQPct === null ? "—" : formatPct(m.sipAmcPrevQPct)} prior quarter)`
  );

  if (sheet.ratio) {
    const direction = (sheet.ratio.sdLevel ?? 0) >= 0 ? "above" : "below";
    bullets.push(
      `• Price/AUM ratio: ${sheet.ratio.sdLevel === null ? "—" : Math.abs(sheet.ratio.sdLevel).toFixed(2)}σ ${direction} historical mean — ` +
        `${sheet.ratio.upsideToMeanPct === null ? "—" : formatPct(sheet.ratio.upsideToMeanPct, { alwaysSign: true })} upside to mean-reversion target ` +
        `${sheet.ratio.fairValueAtMeanInr === null ? "—" : formatPriceInr(sheet.ratio.fairValueAtMeanInr)} ` +
        `(${sheet.ratio.correlationPct === null ? "—" : formatPct(sheet.ratio.correlationPct)} correlation, ` +
        `R² ${sheet.ratio.rSquared === null ? "—" : formatPct(sheet.ratio.rSquared)})`
    );
  }

  // AmcScoreCard.rows is always [currentScore, 15DaysAgo, 1MonthAgo,
  // 1YearAgo, YtdThisFY, YtdSamePeriodLastFY] (see computeAmcScoreCard in
  // amc-score.ts) -- row 1 and row 3 are the same 6-Month-Avg metric as
  // row 0, just evaluated 15 days / 1 year earlier, each already carrying
  // its own changePct vs row 0. NOT a 0-100 scale, so no "/100" suffix.
  const scoreRows = sheet.amcScore?.rows ?? [];
  const currentScore = scoreRows[0]?.score ?? null;
  const formatScoreComparison = (label: string, row: { score: number | null; changePct: number | null } | undefined) => {
    if (!row || row.score === null) return null;
    const chg = row.changePct === null ? "" : ` (${formatPct(row.changePct, { alwaysSign: true })})`;
    return `${row.score.toFixed(2)} ${label}${chg}`;
  };
  const scoreComparisons = [formatScoreComparison("15 days ago", scoreRows[1]), formatScoreComparison("a year ago", scoreRows[3])].filter(
    (s): s is string => s !== null
  );
  let scoreBullet = `• AMC Score: ${currentScore === null ? "—" : currentScore.toFixed(2)}`;
  if (scoreComparisons.length > 0) scoreBullet += ` vs ${scoreComparisons.join(" and ")}`;
  const chg15 = scoreRows[1]?.changePct ?? null;
  const chg1yr = scoreRows[3]?.changePct ?? null;
  if (chg15 !== null && chg1yr !== null) {
    if (chg15 > 0 && chg1yr > 0) scoreBullet += " — improving";
    else if (chg15 < 0 && chg1yr < 0) scoreBullet += " — deteriorating";
  }
  bullets.push(scoreBullet);

  const targetPriceBase = sheet.valuation.fy28TargetPriceInr.base;
  const upsideBase = sheet.valuation.fy28UpsidePct.base;
  bullets.push(
    `• Valuation: Base-case Target PE ${m.targetPeBase === null ? "—" : m.targetPeBase}x FY28E PAT → Target Price ` +
      `${targetPriceBase === null ? "—" : formatPriceInr(targetPriceBase)}, ` +
      `${upsideBase === null ? "—" : formatPct(upsideBase, { alwaysSign: true })} upside from CMP ` +
      `${sheet.cmpInr === null ? "—" : formatPriceInr(sheet.cmpInr)}`
  );

  const effectiveVerdict = m.verdictOverride ?? sheet.autoVerdict;
  bullets.push(`• Verdict: ${effectiveVerdict === null ? "—" : effectiveVerdict.toUpperCase()}`);

  return bullets.join("\n");
}

const VERDICT_LABELS: Record<VerdictTier, string> = {
  buy: "BUY",
  accumulate: "ACCUMULATE",
  hold: "HOLD",
  reduce: "REDUCE",
  sell: "SELL",
};

// Graded 5-tier scale -- Buy/Sell at full saturation, Accumulate/Reduce at
// the same lighter PctCell-style tints used throughout this tab, Hold in a
// neutral amber (distinct from both the green and red families).
const VERDICT_PILL_CLASS: Record<VerdictTier, string> = {
  buy: "bg-[#15803d] text-white dark:bg-[#16a34a] dark:text-[#052e16]",
  accumulate: "bg-[#C6EFCE] text-[#006100] dark:bg-[#0d3b2b] dark:text-[#6ee7b7]",
  hold: "bg-[#FEF3C7] text-[#92400E] dark:bg-[#3a2e05] dark:text-[#fcd34d]",
  reduce: "bg-[#fed7aa] text-[#9a3412] dark:bg-[#4a2310] dark:text-[#fdba74]",
  sell: "bg-[#FFC7CE] text-[#9C0006] dark:bg-[#4c1113] dark:text-[#fca5a5]",
};

// A single global threshold's inline, commit-on-blur number input --
// deliberately NOT EditNumberCell (which renders its own <TableCell>, only
// valid inside a <Table>) since the Overview card is a plain flex/grid
// layout, not a table. Displays/accepts a whole percentage (e.g. 25), but
// stores/sends the underlying fraction (0.25) like every other pct field.
function ThresholdInput({
  valuePct,
  onCommit,
}: {
  valuePct: number;
  onCommit: (newPct: number) => void;
}) {
  const [draft, setDraft] = useState(String(valuePct));
  const [prev, setPrev] = useState(valuePct);
  if (valuePct !== prev) {
    setPrev(valuePct);
    setDraft(String(valuePct));
  }
  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft);
        if (Number.isFinite(parsed) && parsed !== valuePct) onCommit(parsed);
        else setDraft(String(valuePct));
      }}
      className="w-14 rounded border border-dashed bg-background px-1.5 py-0.5 text-right text-xs tabular-nums text-foreground hover:border-foreground/40 focus:border-foreground/60 focus:outline-none"
    />
  );
}

// Read-only, bold-Label/Detail table matching the PDF/Excel Summary box
// exactly (same #f5faff fill / #d7e8f7 border, confirmed shade) -- shown
// by default; clicking it swaps in the editable textarea (see
// OverviewCard's editingSummary state). Uses the same parseSummaryRows
// shared with both exports, so a bullet's continuation line (e.g.
// QAAUM's previous-quarter figures) always renders identically in all 3
// places: this table, the PDF, and Excel.
function SummaryTable({ summary, onClick }: { summary: string | null; onClick: () => void }) {
  const rows = parseSummaryRows(summary);
  return (
    <div
      onClick={onClick}
      title="Click to edit"
      className="cursor-text overflow-hidden rounded-md border"
      style={{ borderColor: "#d7e8f7" }}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex gap-3 px-4 py-2 text-sm"
          style={{
            background: "#f5faff",
            color: "#0b2338",
            borderBottom: i < rows.length - 1 ? "1px solid #d7e8f7" : undefined,
          }}
        >
          <div className="w-36 shrink-0 font-bold">{row.label}</div>
          <div className="whitespace-pre-line">{row.detail}</div>
        </div>
      ))}
    </div>
  );
}

function OverviewCard({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | string | null) => Promise<void>;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const t = sheet.verdictThresholds;
  const effectiveVerdict = sheet.manual.verdictOverride ?? sheet.autoVerdict;

  function updateThreshold(field: keyof VerdictThresholds, newPct: number) {
    saveVerdictThresholds({ ...t, [field]: newPct / 100 });
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      await onSave("summary", generateOverviewDraft(sheet));
      setEditingSummary(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate summary");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div
        className="flex flex-wrap items-end justify-between gap-4 px-5 py-4 text-white"
        style={{ background: "linear-gradient(120deg, #0f172a, #1e3a8a)" }}
      >
        <div>
          <div className="text-lg font-extrabold">{sheet.overviewName}</div>
          <div className="mt-0.5 text-xs text-slate-300">
            As of {formatShortDate(sheet.asOfDate)} · CMP {sheet.cmpInr === null ? "—" : formatPriceInr(sheet.cmpInr)}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div className="text-right">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-300">Target Price (Base)</div>
            <div className="text-base font-bold tabular-nums">
              {sheet.valuation.fy28TargetPriceInr.base === null ? "—" : formatPriceInr(sheet.valuation.fy28TargetPriceInr.base)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-300">Upside</div>
            <div className="text-base font-bold tabular-nums" style={{ color: (sheet.valuation.fy28UpsidePct.base ?? 0) >= 0 ? "#86efac" : "#fca5a5" }}>
              {sheet.valuation.fy28UpsidePct.base === null ? "—" : formatPct(sheet.valuation.fy28UpsidePct.base, { alwaysSign: true })}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-300">Target Period</div>
            <div className="text-sm font-semibold">FY28E</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-blue-300">Verdict</div>
            <span className={`rounded-full px-3 py-1 text-xs font-extrabold tracking-wide ${effectiveVerdict ? VERDICT_PILL_CLASS[effectiveVerdict] : "bg-white/20 text-white"}`}>
              {effectiveVerdict ? VERDICT_LABELS[effectiveVerdict] : "—"}
            </span>
            <select
              value={sheet.manual.verdictOverride ?? ""}
              onChange={(e) => onSave("verdictOverride", e.target.value === "" ? null : e.target.value)}
              className="rounded border border-dashed border-white/40 bg-white/10 px-1.5 py-0.5 text-[11px] text-white focus:border-white focus:outline-none"
              title="Auto-suggested from the Base-case upside %; pick to override"
            >
              <option value="" className="text-black">
                Auto ({sheet.autoVerdict ? VERDICT_LABELS[sheet.autoVerdict] : "—"})
              </option>
              {VERDICT_TIERS.map((tier) => (
                <option key={tier} value={tier} className="text-black">
                  Override: {VERDICT_LABELS[tier]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-5 py-2 text-[11px] text-muted-foreground">
        <span>Thresholds on Base-case upside:</span>
        <span>
          Buy &gt; <ThresholdInput valuePct={Math.round(t.buyMinPct * 100)} onCommit={(v) => updateThreshold("buyMinPct", v)} />%
        </span>
        <span>
          Accumulate &gt; <ThresholdInput valuePct={Math.round(t.accumulateMinPct * 100)} onCommit={(v) => updateThreshold("accumulateMinPct", v)} />%
        </span>
        <span>
          Hold &gt; <ThresholdInput valuePct={Math.round(t.holdMinPct * 100)} onCommit={(v) => updateThreshold("holdMinPct", v)} />%
        </span>
        <span>
          Reduce &gt; <ThresholdInput valuePct={Math.round(t.reduceMinPct * 100)} onCommit={(v) => updateThreshold("reduceMinPct", v)} />%
        </span>
        <span>else Sell · applies to all 8 AMCs</span>
      </div>
      <div className="px-5 py-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Analyst Summary (editable)</span>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            title="Replaces this text with a fresh draft built from every other card's current figures"
          >
            {regenerating ? "Regenerating…" : "↻ Regenerate from data"}
          </button>
        </div>
        {editingSummary ? (
          <EditTextareaCell
            value={sheet.manual.summary}
            onSave={async (v) => {
              await onSave("summary", v);
              setEditingSummary(false);
            }}
            placeholder='Click "Regenerate from data" for an auto-drafted starting point, or write your own.'
          />
        ) : (
          <SummaryTable summary={sheet.manual.summary} onClick={() => setEditingSummary(true)} />
        )}
      </div>
    </div>
  );
}

function FortnightlySheetView({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | string | null) => Promise<void>;
}) {
  const m = sheet.manual;
  const v = sheet.valuation;

  return (
    <div className="space-y-4">
      {/* Overview: leads with the verdict banner, above every other card */}
      <OverviewCard sheet={sheet} onSave={onSave} />

      {/* Row 1: Stock/CMP/Shares + PAT/CAGR */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className={TABLE_TEXT_CLASS}>
            <TableBody>
              <SectionBanner title="Stock" colSpan={2} />
              <LabelRow label="Stock" bold>
                <TableCell className="text-right font-semibold">{sheet.overviewName}</TableCell>
              </LabelRow>
              <LabelRow label="CMP">
                <TableCell className="text-right tabular-nums" title="Latest EOD close on or before the As-of date, pulled from the dashboard">
                  {sheet.cmpInr === null ? "—" : formatPriceInr(sheet.cmpInr)}
                </TableCell>
              </LabelRow>
              <LabelRow label="No of Shares (Cr)">
                <ManualCell value={m.noOfSharesCr} onSave={(val) => onSave("noOfSharesCr", val)} />
              </LabelRow>
            </TableBody>
          </Table>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className={TABLE_TEXT_CLASS}>
            <TableBody>
              <SectionBanner title="PAT" colSpan={5} />
              <TableRow>
                <TableCell className="font-semibold">Period</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">FY26A</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">FY27E</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">FY28E</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">2Y CAGR</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">PAT (Cr)</TableCell>
                <ManualCell value={m.patFy26aCr} onSave={(val) => onSave("patFy26aCr", val)} decimals={0} />
                <ManualCell value={m.patFy27eCr} onSave={(val) => onSave("patFy27eCr", val)} decimals={0} />
                <ManualCell value={m.patFy28eCr} onSave={(val) => onSave("patFy28eCr", val)} decimals={0} />
                <PctCell value={v.cagr2yPct} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Row 2: Bear/Base/Bull valuation block + QAAUM */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className={TABLE_TEXT_CLASS}>
            <TableBody>
              <SectionBanner title="Valuation (Bear / Base / Bull)" colSpan={4} />
              <ScenarioHeaderRow />
              <ScenarioEditRow
                label="Target PE"
                bear={m.targetPeBear}
                base={m.targetPeBase}
                bull={m.targetPeBull}
                onSave={onSave}
                title="Manual -- FY28 Target Market Cap = PAT FY28E x Target PE"
              />
              <ScenarioMcapRow label="FY28 Target Market Cap (Cr)" values={v.fy28TargetMcapCr} />
              <ScenarioPriceRow label="Target Price" values={v.fy28TargetPriceInr} bold />
              <ScenarioPctRow label="Upside %" values={v.fy28UpsidePct} />

              <TableRow>
                <TableCell className="pt-4 font-semibold">FY27 Discounted</TableCell>
                <TableCell className="pt-4 text-right text-xs text-[#262626] dark:text-[#d4d4d4]" colSpan={2}>
                  Discount rate (%)
                </TableCell>
                <EditNumberCell
                  value={numOrZero(m.discountRateFy27Pct !== null ? m.discountRateFy27Pct * 100 : null)}
                  isOverridden={m.discountRateFy27Pct !== null}
                  onSave={(val) => onSave("discountRateFy27Pct", val === null ? null : val / 100)}
                  title="Manual -- annual discount rate (%) applied to bring the FY28 target price back to an FY27 value"
                  inputClassName={INPUT_CELL_CLASS}
                />
              </TableRow>
              <ScenarioPriceRow label="FY27 Discounted Price" values={v.fy27DiscountedPriceInr} />
              <ScenarioPctRow label="Upside %" values={v.fy27UpsidePct} />

              <TableRow>
                <TableCell className="pt-4 font-semibold">FY26 Discounted</TableCell>
                <TableCell className="pt-4 text-right text-xs text-[#262626] dark:text-[#d4d4d4]" colSpan={2}>
                  Discount rate (%)
                </TableCell>
                <EditNumberCell
                  value={numOrZero(m.discountRateFy26Pct !== null ? m.discountRateFy26Pct * 100 : null)}
                  isOverridden={m.discountRateFy26Pct !== null}
                  onSave={(val) => onSave("discountRateFy26Pct", val === null ? null : val / 100)}
                  title="Manual -- additional annual discount rate (%), compounded with the FY27 rate, to bring the FY28 target price back to an FY26 value"
                  inputClassName={INPUT_CELL_CLASS}
                />
              </TableRow>
              <ScenarioPriceRow label="FY26 Discounted Price" values={v.fy26DiscountedPriceInr} />
              <ScenarioPctRow label="Upside %" values={v.fy26UpsidePct} />
            </TableBody>
          </Table>
        </div>

        {/* MTM Growth - QAAUM -- pulled, read-only */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className={TABLE_TEXT_CLASS}>
            <TableBody>
              <SectionBanner title="MTM Growth - QAAUM" colSpan={4} />
              <TableRow>
                <TableCell className="text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Period</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Val (Cr)</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">QoQ</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">YoY</TableCell>
              </TableRow>
              {sheet.qaaum.map((row) => (
                <TableRow key={row.label}>
                  <TableCell>
                    <div className="font-semibold">{row.label}</div>
                    <div className="text-[12px] font-normal text-[#262626]/70 dark:text-[#d4d4d4]/70">
                      {formatShortDate(row.range[0])} – {formatShortDate(row.range[1])}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.valCr === null ? "—" : formatCrRounded(row.valCr)}</TableCell>
                  <PctCell value={row.qoqPct ?? null} />
                  <PctCell value={row.yoyPct ?? null} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Row 3: SIP AMC Growth / SIP Industry Growth (Quarterly) -- fully
          manual / auto-pulled respectively */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SipAmcGrowthTable sheet={sheet} onSave={onSave} />
        <SipIndustryQuarterlyGrowthTable sheet={sheet} onSave={onSave} />
      </div>

      {/* Row 4: Ratio section (pulled, read-only) / SIP Industry Growth
          (Monthly) -- the monthly card moved here to make room for the new
          quarterly one above, in Row 3's old slot. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className={TABLE_TEXT_CLASS}>
            <TableBody>
              <SectionBanner title="Ratio (Price / Avg AUM)" colSpan={2} />
              <LabelRow label="SD Level">
                <TableCell className="text-right tabular-nums">
                  {sheet.ratio?.sdLevel === null || sheet.ratio?.sdLevel === undefined ? "—" : sheet.ratio.sdLevel.toFixed(2)}
                </TableCell>
              </LabelRow>
              <LabelRow label="Upside to Mean">
                <PctCell value={sheet.ratio?.upsideToMeanPct ?? null} />
              </LabelRow>
              <LabelRow label="Mean Target Price">
                <PriceCell value={sheet.ratio?.fairValueAtMeanInr ?? null} />
              </LabelRow>
              <LabelRow label="Time Period">
                <TableCell className="text-right">{sheet.ratio?.timePeriodLabel ?? "—"}</TableCell>
              </LabelRow>
              <LabelRow label="Avg AUM Days">
                <TableCell className="text-right">{sheet.ratio ? `${sheet.ratio.avgAumDays} Days` : "—"}</TableCell>
              </LabelRow>
              <LabelRow label="Correlation">
                <PctCell value={sheet.ratio?.correlationPct ?? null} />
              </LabelRow>
              <LabelRow label="R-Square">
                <PctCell value={sheet.ratio?.rSquared ?? null} />
              </LabelRow>
            </TableBody>
          </Table>
          <p className="border-t px-3 py-2 text-xs text-[#262626] dark:text-[#d4d4d4]">
            Uses the Stock Correlation tab&apos;s own shared Date Range / Moving Avg settings.
          </p>
        </div>
        <SipIndustryGrowthTable sheet={sheet} onSave={onSave} />
      </div>

      {/* Row 5: AMC Score -- pulled from a separate Supabase project,
          read-only (trailing, no pair) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <AmcScoreCard sheet={sheet} onSave={onSave} />
      </div>
    </div>
  );
}

function SipAmcGrowthTable({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | string | null) => Promise<void>;
}) {
  const m = sheet.manual;
  const labels = sheet.sipAmcLabels;
  const rows: { label: string; valField: FortnightlyFieldName; pctField: FortnightlyFieldName; val: number | null; pct: number | null }[] = [
    { label: `Latest Available Quarter (${labels.qtd})`, valField: "sipAmcQtdValCr", pctField: "sipAmcQtdPct", val: m.sipAmcQtdValCr, pct: m.sipAmcQtdPct },
    { label: `Previous Quarter (${labels.prevQ})`, valField: "sipAmcPrevQValCr", pctField: "sipAmcPrevQPct", val: m.sipAmcPrevQValCr, pct: m.sipAmcPrevQPct },
    { label: `Previous Quarter (${labels.prevQ2})`, valField: "sipAmcPrevQ2ValCr", pctField: "sipAmcPrevQ2Pct", val: m.sipAmcPrevQ2ValCr, pct: m.sipAmcPrevQ2Pct },
    { label: `Last Year Same Quarter (${labels.yoyQ})`, valField: "sipAmcYoyQValCr", pctField: "sipAmcYoyQPct", val: m.sipAmcYoyQValCr, pct: m.sipAmcYoyQPct },
    { label: `Last Year Same Quarter (${labels.yoyQ2})`, valField: "sipAmcYoyQ2ValCr", pctField: "sipAmcYoyQ2Pct", val: m.sipAmcYoyQ2ValCr, pct: m.sipAmcYoyQ2Pct },
  ];
  const qoq = rows[1].val !== null && rows[0].val !== null && rows[1].val !== 0 ? rows[0].val / rows[1].val - 1 : null;
  const qoqPrev = rows[2].val !== null && rows[1].val !== null && rows[2].val !== 0 ? rows[1].val / rows[2].val - 1 : null;
  const yoy = rows[3].val !== null && rows[0].val !== null && rows[3].val !== 0 ? rows[0].val / rows[3].val - 1 : null;
  const yoyPrev = rows[4].val !== null && rows[1].val !== null && rows[4].val !== 0 ? rows[1].val / rows[4].val - 1 : null;
  const qoqByRow = [qoq, qoqPrev, null, null, null];
  const yoyByRow = [yoy, yoyPrev, null, null, null];

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className={TABLE_TEXT_CLASS}>
        <TableBody>
          <SectionBanner title="SIP AMC Growth" colSpan={5} />
          <TableRow>
            <TableCell className="font-semibold">Latest Available Quarter</TableCell>
            <TableCell colSpan={2} />
            <TableCell>
              <div className="flex justify-end">
                <select
                  value={sheet.sipAmcLatestQuarter}
                  onChange={(e) => onSave("sipAmcLatestQuarter", Number(e.target.value))}
                  title="Which fiscal quarter the AMC's own SIP figures below are reported for -- no live data source for this, so pick it directly"
                  className={`${inlineSelectClass} w-16`}
                >
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      Q{q}
                    </option>
                  ))}
                </select>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex justify-end">
                <select
                  value={sheet.sipAmcLatestFy}
                  onChange={(e) => onSave("sipAmcLatestFy", Number(e.target.value))}
                  title="Fiscal year for the quarter above"
                  className={`${inlineSelectClass} w-20`}
                >
                  {fyOptionsAround(sheet.sipAmcLatestFy).map((fy) => (
                    <option key={fy} value={fy}>
                      FY{String(fy).slice(-2)}
                    </option>
                  ))}
                </select>
              </div>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Period</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Val (Cr)</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">QoQ</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">YoY</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">SIP/Equity AUM</TableCell>
          </TableRow>
          {rows.map((row, i) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <ManualCell value={row.val} onSave={(v) => onSave(row.valField, v)} decimals={0} />
              <PctCell value={qoqByRow[i]} />
              <PctCell value={yoyByRow[i]} />
              <ManualCell
                value={row.pct !== null ? row.pct * 100 : null}
                onSave={(v) => onSave(row.pctField, v === null ? null : v / 100)}
                title="SIP as a % of this period's Equity AUM -- gradient-colored: lowest of the 5 periods is red, highest is green"
                suffix="%"
                inputStyle={sipEquityAumGradientStyle(
                  row.pct,
                  rows.map((r) => r.pct)
                )}
              />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Quarterly counterpart of SipIndustryGrowthTable -- same auto-pulled
// pattern (ManualOrAutoCell for the Val cells, FY/Quarter picker instead
// of Month/Year), reading sheet.sipIndustryQuarterlyAuto instead of
// sheet.sipIndustryAuto. "QoQ" instead of "MoM" is the only header change.
// Unlike the Val cells (still per-AMC), the anchor picker now saves a
// single GLOBAL setting shared by both SIP Industry cards and every AMC
// (see saveSipIndustryAnchorMonth) -- there's no more manual-vs-auto split
// for the anchor itself, just one current value.
function SipIndustryQuarterlyGrowthTable({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | string | null) => Promise<void>;
}) {
  const m = sheet.manual;
  const auto = sheet.sipIndustryQuarterlyAuto;
  const labels = auto?.labels;
  const rows: { label: string; field: FortnightlyFieldName; manualVal: number | null; autoVal: number | null }[] = [
    { label: `Latest Available Quarter${labels ? ` (${labels.qtd})` : ""}`, field: "sipIndustryQtrQtdValCr", manualVal: m.sipIndustryQtrQtdValCr, autoVal: auto?.values.qtd ?? null },
    { label: `Previous Quarter${labels ? ` (${labels.prevQ})` : ""}`, field: "sipIndustryQtrPrevQValCr", manualVal: m.sipIndustryQtrPrevQValCr, autoVal: auto?.values.prevQ ?? null },
    { label: `Previous Quarter${labels ? ` (${labels.prevQ2})` : ""}`, field: "sipIndustryQtrPrevQ2ValCr", manualVal: m.sipIndustryQtrPrevQ2ValCr, autoVal: auto?.values.prevQ2 ?? null },
    { label: `Last Year Same Quarter${labels ? ` (${labels.yoyQ})` : ""}`, field: "sipIndustryQtrYoyQValCr", manualVal: m.sipIndustryQtrYoyQValCr, autoVal: auto?.values.yoyQ ?? null },
    { label: `Last Year Same Quarter${labels ? ` (${labels.yoyQ2})` : ""}`, field: "sipIndustryQtrYoyQ2ValCr", manualVal: m.sipIndustryQtrYoyQ2ValCr, autoVal: auto?.values.yoyQ2 ?? null },
  ];
  const effectiveVals = rows.map((row) => row.manualVal ?? row.autoVal);
  const qoq = effectiveVals[1] !== null && effectiveVals[0] !== null && effectiveVals[1] !== 0 ? effectiveVals[0] / effectiveVals[1] - 1 : null;
  const qoqPrev = effectiveVals[2] !== null && effectiveVals[1] !== null && effectiveVals[2] !== 0 ? effectiveVals[1] / effectiveVals[2] - 1 : null;
  const yoy = effectiveVals[3] !== null && effectiveVals[0] !== null && effectiveVals[3] !== 0 ? effectiveVals[0] / effectiveVals[3] - 1 : null;
  const yoyPrev = effectiveVals[4] !== null && effectiveVals[1] !== null && effectiveVals[4] !== 0 ? effectiveVals[1] / effectiveVals[4] - 1 : null;
  const qoqByRow = [qoq, qoqPrev, null, null, null];
  const yoyByRow = [yoy, yoyPrev, null, null, null];

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className={TABLE_TEXT_CLASS}>
        <TableBody>
          <SectionBanner title="SIP Industry Growth (Quarterly)" colSpan={4} />
          {auto && (
            <TableRow>
              <TableCell className="font-semibold">Latest Available Quarter</TableCell>
              <TableCell />
              <TableCell>
                <div className="flex justify-end">
                  <select
                    value={auto.anchorQuarter}
                    onChange={(e) => saveSipIndustryQuarterAnchor(auto.anchorFy, Number(e.target.value))}
                    title="Which fiscal quarter the industry-wide SIP figures below are reported for -- resolves to the last REAL AMFI month inside that quarter, a single global setting shared by every AMC and by the Monthly card; defaults to the last real AMFI month"
                    className={`${inlineSelectClass} w-16`}
                  >
                    {[1, 2, 3, 4].map((q) => (
                      <option key={q} value={q}>
                        Q{q}
                      </option>
                    ))}
                  </select>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <select
                    value={auto.anchorFy}
                    onChange={(e) => saveSipIndustryQuarterAnchor(Number(e.target.value), auto.anchorQuarter)}
                    title="Fiscal year for the quarter above -- same global setting"
                    className={`${inlineSelectClass} w-20`}
                  >
                    {fyOptionsAround(auto.anchorFy).map((fy) => (
                      <option key={fy} value={fy}>
                        FY{String(fy).slice(-2)}
                      </option>
                    ))}
                  </select>
                </div>
              </TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell className="flex items-center gap-1.5 text-[12px] font-normal normal-case text-[#262626] dark:text-[#d4d4d4]">
              <input
                type="checkbox"
                checked={Boolean(auto?.estimate)}
                onChange={(e) => saveSipIndustryShowEstimate(e.target.checked)}
                className="size-3.5"
              />
              Show estimated next quarter
            </TableCell>
            <TableCell colSpan={3} />
          </TableRow>
          <TableRow>
            <TableCell className="text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Period</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Val (Cr)</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">QoQ</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">YoY</TableCell>
          </TableRow>
          {rows.map((row, i) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <ManualOrAutoCell
                manualValue={row.manualVal}
                autoValue={row.autoVal}
                onSave={(v) => onSave(row.field, v)}
                title="Auto-pulled from the Summary tab's industry-wide SIP data, summed over the fiscal quarter; type a value to override"
                decimals={0}
              />
              <PctCell value={qoqByRow[i]} />
              <PctCell value={yoyByRow[i]} />
            </TableRow>
          ))}
          {auto?.estimate && (
            <TableRow>
              <TableCell className="italic text-muted-foreground">{auto.estimate.label}</TableCell>
              <TableCell className="text-right tabular-nums italic text-muted-foreground">{formatCrRounded(auto.estimate.valueCr)}</TableCell>
              <PctCell
                value={
                  effectiveVals[0] !== null && effectiveVals[0] !== 0 ? auto.estimate.valueCr / effectiveVals[0] - 1 : null
                }
              />
              <PctCell value={auto.estimate.yoyPct} />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SipIndustryGrowthTable({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | string | null) => Promise<void>;
}) {
  const m = sheet.manual;
  const auto = sheet.sipIndustryAuto;
  const withPeriod = (base: string, period: string | undefined) => (period ? `${base} (${period})` : base);
  const rows: { label: string; field: FortnightlyFieldName; manualVal: number | null; autoVal: number | null }[] = [
    { label: withPeriod("Latest Available Month", auto?.labels.qtd), field: "sipIndustryMtdValCr", manualVal: m.sipIndustryMtdValCr, autoVal: auto?.values.mtd ?? null },
    { label: withPeriod("Previous Month", auto?.labels.prevQ), field: "sipIndustryPrevMValCr", manualVal: m.sipIndustryPrevMValCr, autoVal: auto?.values.prevM ?? null },
    { label: withPeriod("Previous Month", auto?.labels.prevQ2), field: "sipIndustryPrevM2ValCr", manualVal: m.sipIndustryPrevM2ValCr, autoVal: auto?.values.prevM2 ?? null },
    { label: withPeriod("Last Year Month", auto?.labels.yoyQ), field: "sipIndustryYoyMValCr", manualVal: m.sipIndustryYoyMValCr, autoVal: auto?.values.yoyM ?? null },
    { label: withPeriod("Last Year Month", auto?.labels.yoyQ2), field: "sipIndustryYoyM2ValCr", manualVal: m.sipIndustryYoyM2ValCr, autoVal: auto?.values.yoyM2 ?? null },
  ];
  const effectiveVals = rows.map((row) => row.manualVal ?? row.autoVal);
  const mom = effectiveVals[1] !== null && effectiveVals[0] !== null && effectiveVals[1] !== 0 ? effectiveVals[0] / effectiveVals[1] - 1 : null;
  const momPrev = effectiveVals[2] !== null && effectiveVals[1] !== null && effectiveVals[2] !== 0 ? effectiveVals[1] / effectiveVals[2] - 1 : null;
  const yoy = effectiveVals[3] !== null && effectiveVals[0] !== null && effectiveVals[3] !== 0 ? effectiveVals[0] / effectiveVals[3] - 1 : null;
  const yoyPrev = effectiveVals[4] !== null && effectiveVals[1] !== null && effectiveVals[4] !== 0 ? effectiveVals[1] / effectiveVals[4] - 1 : null;
  const momByRow = [mom, momPrev, null, null, null];
  const yoyByRow = [yoy, yoyPrev, null, null, null];

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className={TABLE_TEXT_CLASS}>
        <TableBody>
          <SectionBanner title="SIP Industry Growth (Monthly)" colSpan={4} />
          {auto && (
            <TableRow>
              <TableCell className="font-semibold">Latest Available Month</TableCell>
              <TableCell />
              <TableCell>
                <div className="flex justify-end">
                  <select
                    value={auto.anchorMonth}
                    onChange={(e) => saveSipIndustryAnchorMonth(`${auto.anchorYear}-${e.target.value.padStart(2, "0")}`)}
                    title="Which month the industry-wide SIP figures below are reported for -- a single global setting shared by every AMC and by the Quarterly card; defaults to the last real AMFI month"
                    className={`${inlineSelectClass} w-20`}
                  >
                    {MONTH_ABBREV.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <select
                    value={auto.anchorYear}
                    onChange={(e) => saveSipIndustryAnchorMonth(`${e.target.value}-${String(auto.anchorMonth).padStart(2, "0")}`)}
                    title="Year for the month above -- same global setting"
                    className={`${inlineSelectClass} w-20`}
                  >
                    {yearOptionsAround(auto.anchorYear).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell className="flex items-center gap-1.5 text-[12px] font-normal normal-case text-[#262626] dark:text-[#d4d4d4]">
              <input
                type="checkbox"
                checked={Boolean(auto?.estimate)}
                onChange={(e) => saveSipIndustryShowEstimate(e.target.checked)}
                className="size-3.5"
              />
              Show estimated next month
            </TableCell>
            <TableCell colSpan={3} />
          </TableRow>
          <TableRow>
            <TableCell className="text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Period</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Val (Cr)</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">MoM</TableCell>
            <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">YoY</TableCell>
          </TableRow>
          {rows.map((row, i) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <ManualOrAutoCell
                manualValue={row.manualVal}
                autoValue={row.autoVal}
                onSave={(v) => onSave(row.field, v)}
                title="Auto-pulled from the Summary tab's industry-wide SIP data; type a value to override"
                decimals={0}
              />
              <PctCell value={momByRow[i]} />
              <PctCell value={yoyByRow[i]} />
            </TableRow>
          ))}
          {auto?.estimate && (
            <TableRow>
              <TableCell className="italic text-muted-foreground">{auto.estimate.label}</TableCell>
              <TableCell className="text-right tabular-nums italic text-muted-foreground">{formatCrRounded(auto.estimate.valueCr)}</TableCell>
              <PctCell
                value={
                  effectiveVals[0] !== null && effectiveVals[0] !== 0 ? auto.estimate.valueCr / effectiveVals[0] - 1 : null
                }
              />
              <PctCell value={auto.estimate.yoyPct} />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// Pulled from a separate, not-yet-connected-elsewhere Supabase project (see
// src/lib/aum/amc-score.ts) -- entirely auto-computed, no manual value
// overrides (unlike the SIP cards), so Score is a plain read-only cell, not
// an EditNumberCell. The only writable field is the anchor date itself.
function AmcScoreCard({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | string | null) => Promise<void>;
}) {
  const card = sheet.amcScore;
  const availableDates = sheet.amcScoreAvailableDates;

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className={TABLE_TEXT_CLASS}>
        <TableBody>
          <SectionBanner title="AMC Score" colSpan={3} />
          {card && availableDates.length > 0 && (
            <TableRow>
              <TableCell className="font-semibold">Anchor Date</TableCell>
              <TableCell />
              <TableCell>
                <div className="flex justify-end">
                  <select
                    value={card.anchorDate}
                    onChange={(e) => onSave("amcScoreAnchorDate", e.target.value)}
                    title="Which amc_scores snapshot date this card anchors to -- defaults to the latest available snapshot; an override here applies only to this one snapshot"
                    className={`${inlineSelectClass} w-32`}
                  >
                    {availableDates.map((d) => (
                      <option key={d} value={d}>
                        {formatAnchorDateOption(d)}
                      </option>
                    ))}
                  </select>
                </div>
              </TableCell>
            </TableRow>
          )}
          {card ? (
            <>
              <TableRow>
                <TableCell className="text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Period</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Score</TableCell>
                <TableCell className="text-right text-[12px] font-semibold uppercase text-[#262626] dark:text-[#d4d4d4]">Change</TableCell>
              </TableRow>
              {card.rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{row.score === null ? "—" : row.score.toFixed(2)}</TableCell>
                  <PctCell value={row.changePct} />
                </TableRow>
              ))}
            </>
          ) : (
            <TableRow>
              <TableCell colSpan={3} className="py-4 text-center text-[#262626] dark:text-[#d4d4d4]">
                No AMC Score data available for this fund.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
