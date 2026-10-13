"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EditNumberCell } from "./edit-number-cell";
import { FortnightlyDownloadPanel } from "./fortnightly-download-panel";
import { useFortnightlyEligibleAmcs, useFortnightlySheet } from "@/hooks/use-fortnightly-update";
import { formatCr, formatPct, formatPriceInr, formatShortDate } from "@/lib/utils/format";
import type { FortnightlyFieldName, FortnightlySheet, ScenarioValues } from "@/lib/aum/fortnightly-update";

const selectClass =
  "min-w-0 max-w-[260px] rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

function numOrZero(v: number | null): number {
  return v ?? 0;
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
  if (value === null) return <TableCell className={`text-right tabular-nums text-muted-foreground ${className ?? ""}`}>—</TableCell>;
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

  const { data: sheet, error, isLoading, mutate } = useFortnightlySheet(amcId, asOfDate);

  // Reset the date selector back to "latest" whenever the AMC changes, so
  // switching AMCs never silently carries over a date that may not exist
  // for the newly-selected one.
  function handleAmcChange(newAmcId: number) {
    setAmcId(newAmcId);
    setAsOfDate(null);
  }

  async function saveField(field: FortnightlyFieldName, value: number | null) {
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
    return <p className="text-center text-muted-foreground">Failed to load: {error.message}</p>;
  }

  if (!amcsData || amcsData.amcs.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">No listed-stock AMCs configured yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="fortnightly-amc" className="text-xs text-muted-foreground">
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
            <label htmlFor="fortnightly-date" className="text-xs text-muted-foreground">
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
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  title?: string;
}) {
  return <EditNumberCell value={numOrZero(value)} isOverridden={value !== null} onSave={onSave} title={title} />;
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
}: {
  manualValue: number | null;
  autoValue: number | null;
  onSave: (v: number | null) => Promise<void>;
  title?: string;
}) {
  const effective = manualValue ?? autoValue;
  return <EditNumberCell value={numOrZero(effective)} isOverridden={manualValue !== null} onSave={onSave} title={title} />;
}

function ScenarioHeaderRow() {
  return (
    <TableRow>
      <TableCell />
      <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">Bear</TableCell>
      <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">Base</TableCell>
      <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">Bull</TableCell>
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
      <TableCell className="text-muted-foreground">{label}</TableCell>
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
      <TableCell className="text-right tabular-nums">{values.bear === null ? "—" : formatCr(values.bear)}</TableCell>
      <TableCell className="text-right tabular-nums">{values.base === null ? "—" : formatCr(values.base)}</TableCell>
      <TableCell className="text-right tabular-nums">{values.bull === null ? "—" : formatCr(values.bull)}</TableCell>
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

function FortnightlySheetView({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | null) => Promise<void>;
}) {
  const m = sheet.manual;
  const v = sheet.valuation;

  return (
    <div className="space-y-4">
      {/* Row 1: Stock/CMP/Shares + PAT/CAGR */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
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
          <Table>
            <TableBody>
              <SectionBanner title="PAT" colSpan={5} />
              <TableRow>
                <TableCell className="font-semibold">Period</TableCell>
                <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">FY26A</TableCell>
                <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">FY27E</TableCell>
                <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">FY28E</TableCell>
                <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">2Y CAGR</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">PAT (Cr)</TableCell>
                <ManualCell value={m.patFy26aCr} onSave={(val) => onSave("patFy26aCr", val)} />
                <ManualCell value={m.patFy27eCr} onSave={(val) => onSave("patFy27eCr", val)} />
                <ManualCell value={m.patFy28eCr} onSave={(val) => onSave("patFy28eCr", val)} />
                <PctCell value={v.cagr2yPct} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Row 2: Bear/Base/Bull valuation block + QAAUM */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
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
                <TableCell className="pt-4 text-right text-xs text-muted-foreground" colSpan={2}>
                  Discount rate (%)
                </TableCell>
                <EditNumberCell
                  value={numOrZero(m.discountRateFy27Pct !== null ? m.discountRateFy27Pct * 100 : null)}
                  isOverridden={m.discountRateFy27Pct !== null}
                  onSave={(val) => onSave("discountRateFy27Pct", val === null ? null : val / 100)}
                  title="Manual -- annual discount rate (%) applied to bring the FY28 target price back to an FY27 value"
                />
              </TableRow>
              <ScenarioPriceRow label="FY27 Discounted Price" values={v.fy27DiscountedPriceInr} />
              <ScenarioPctRow label="Upside %" values={v.fy27UpsidePct} />

              <TableRow>
                <TableCell className="pt-4 font-semibold">FY26 Discounted</TableCell>
                <TableCell className="pt-4 text-right text-xs text-muted-foreground" colSpan={2}>
                  Discount rate (%)
                </TableCell>
                <EditNumberCell
                  value={numOrZero(m.discountRateFy26Pct !== null ? m.discountRateFy26Pct * 100 : null)}
                  isOverridden={m.discountRateFy26Pct !== null}
                  onSave={(val) => onSave("discountRateFy26Pct", val === null ? null : val / 100)}
                  title="Manual -- additional annual discount rate (%), compounded with the FY27 rate, to bring the FY28 target price back to an FY26 value"
                />
              </TableRow>
              <ScenarioPriceRow label="FY26 Discounted Price" values={v.fy26DiscountedPriceInr} />
              <ScenarioPctRow label="Upside %" values={v.fy26UpsidePct} />
            </TableBody>
          </Table>
        </div>

        {/* Quarterly Averages (QAAUM) -- pulled, read-only */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableBody>
              <SectionBanner title="Quarterly Averages — QAAUM" colSpan={4} />
              <TableRow>
                <TableCell className="text-[10.5px] font-semibold uppercase text-muted-foreground">Period</TableCell>
                <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">Val (Cr)</TableCell>
                <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">QoQ</TableCell>
                <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">YoY</TableCell>
              </TableRow>
              {sheet.qaaum.map((row) => (
                <TableRow key={row.label}>
                  <TableCell>
                    <div className="font-semibold">{row.label}</div>
                    <div className="text-[10.5px] font-normal text-muted-foreground/70">
                      {formatShortDate(row.range[0])} – {formatShortDate(row.range[1])}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.valCr === null ? "—" : formatCr(row.valCr)}</TableCell>
                  <PctCell value={row.qoqPct ?? null} />
                  <PctCell value={row.yoyPct ?? null} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Row 3: SIP AMC Growth / SIP Industry Growth -- fully manual */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SipAmcGrowthTable sheet={sheet} onSave={onSave} />
        <SipIndustryGrowthTable sheet={sheet} onSave={onSave} />
      </div>

      {/* Row 4: Ratio section -- pulled, read-only (trailing, no pair) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
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
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Uses the Stock Correlation tab&apos;s own shared Date Range / Moving Avg settings.
          </p>
        </div>
      </div>
    </div>
  );
}

function SipAmcGrowthTable({
  sheet,
  onSave,
}: {
  sheet: FortnightlySheet;
  onSave: (field: FortnightlyFieldName, value: number | null) => Promise<void>;
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
      <Table>
        <TableBody>
          <SectionBanner title="SIP AMC Growth" colSpan={5} />
          <TableRow>
            <TableCell className="text-[10.5px] font-semibold uppercase text-muted-foreground">Period</TableCell>
            <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">Val (Cr)</TableCell>
            <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">QoQ</TableCell>
            <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">YoY</TableCell>
            <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">SIP/Equity AUM</TableCell>
          </TableRow>
          {rows.map((row, i) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <ManualCell value={row.val} onSave={(v) => onSave(row.valField, v)} />
              <PctCell value={qoqByRow[i]} />
              <PctCell value={yoyByRow[i]} />
              <ManualCell
                value={row.pct !== null ? row.pct * 100 : null}
                onSave={(v) => onSave(row.pctField, v === null ? null : v / 100)}
                title="SIP as a % of this period's Equity AUM"
              />
            </TableRow>
          ))}
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
  onSave: (field: FortnightlyFieldName, value: number | null) => Promise<void>;
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
      <Table>
        <TableBody>
          <SectionBanner title="SIP Industry Growth" colSpan={4} />
          <TableRow>
            <TableCell className="text-[10.5px] font-semibold uppercase text-muted-foreground">Period</TableCell>
            <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">Val (Cr)</TableCell>
            <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">MoM</TableCell>
            <TableCell className="text-right text-[10.5px] font-semibold uppercase text-muted-foreground">YoY</TableCell>
          </TableRow>
          {rows.map((row, i) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <ManualOrAutoCell
                manualValue={row.manualVal}
                autoValue={row.autoVal}
                onSave={(v) => onSave(row.field, v)}
                title="Auto-pulled from the Summary tab's industry-wide SIP data; type a value to override"
              />
              <PctCell value={momByRow[i]} />
              <PctCell value={yoyByRow[i]} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
