"use client";

import { useState } from "react";
import {
  LEDGER_WEEKDAYS,
  LEDGER_WINDOWS,
  formatLedgerInr,
  formatLedgerPct,
  ledgerChange,
  type LedgerPeriodKind,
  type LedgerWeekday,
  type LedgerWindow,
  type PeriodLedger,
} from "@/lib/aum/period-ledger";

// The Period Ledger's three tables (period | weekday | quarter-by-weekday)
// for one AMC, markup and class names as the design system's reference
// renderer so its stylesheet (amc-analytics.css) applies unchanged. The
// row selections are owned by the parent and shared by every AMC tab, as
// the design specifies ("a choice made on one segment applies to every
// segment"). A switch in the band hides the two weekday tables (on by
// default, every visit); the period table keeps its usual width.

export interface LedgerSelections {
  fy: string[];
  q: string[];
  m: string[];
  /** Per weekday: the quarter table's three selectable rows. */
  wq: Record<LedgerWeekday, string[]>;
}

export type LedgerSelectKey = { kind: LedgerPeriodKind; row: number } | { kind: "wq"; day: LedgerWeekday; row: number };

const KIND_NAMES: Record<LedgerPeriodKind, string> = { fy: "Financial year", q: "Quarter", m: "Month" };

function Badge({ change }: { change: number | null }) {
  const p = formatLedgerPct(change);
  return <span className={`pl-chg pl-chg--${p?.tone ?? "neu"}`}>{p?.text ?? "—"}</span>;
}

function DeltaCell({ change }: { change: number | null }) {
  const p = formatLedgerPct(change);
  if (!p) return <td />;
  return <td className={`pl-delta pl-delta--${p.tone}`}>{p.text}</td>;
}

function Num({ w }: { w: LedgerWindow }) {
  return <span className="pl-num">{formatLedgerInr(w.value)}</span>;
}

function PeriodSelect({
  labels,
  value,
  ariaLabel,
  onChange,
}: {
  labels: string[];
  value: string;
  ariaLabel: string;
  onChange: (label: string) => void;
}) {
  return (
    <select className="pl-sel" aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {[...labels].reverse().map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

function HeaderRow({ cells }: { cells: { text: string; title?: string }[] }) {
  return (
    <tr className="pl-hdr">
      {cells.map((c, i) => (
        <th key={i} scope="col" title={c.title}>
          {c.text}
        </th>
      ))}
    </tr>
  );
}

export function AumSummaryLedger({
  model,
  title,
  unitLine,
  selections,
  onSelect,
}: {
  model: PeriodLedger;
  title: string;
  unitLine: string;
  selections: LedgerSelections;
  onSelect: (key: LedgerSelectKey, label: string) => void;
}) {
  const lists: Record<LedgerPeriodKind, string[]> = { fy: model.fys, q: model.quarters, m: model.months };
  const [hideWeekdays, setHideWeekdays] = useState(true);

  const selRows = (kind: LedgerPeriodKind) => {
    const labels = selections[kind];
    const w0 = model.period(kind, labels[0]);
    return labels.map((label, r) => {
      const w = r === 0 ? w0 : model.period(kind, label);
      return (
        <tr key={`${kind}-${r}`} className={r === 0 ? "pl-cur" : undefined}>
          <td className="pl-c-sel">
            <PeriodSelect
              labels={lists[kind]}
              value={label}
              ariaLabel={`${KIND_NAMES[kind]} row ${r + 1}${r ? ", compared with row 1" : ""}`}
              onChange={(l) => onSelect({ kind, row: r }, l)}
            />
          </td>
          <td>
            <Num w={w} />
          </td>
          <td className="pl-c-chg">{r === 0 ? null : <Badge change={ledgerChange(w0.value, w.value)} />}</td>
          <td />
        </tr>
      );
    });
  };

  const m0 = model.period("m", selections.m[0]);
  const half = model.half(selections.m[0]);
  const last = model.tail(LEDGER_WINDOWS.week);
  const prev = model.tailPrev(LEDGER_WINDOWS.week);
  const mid = model.tail(LEDGER_WINDOWS.mid);
  const long = model.tail(LEDGER_WINDOWS.long);
  const latestWeek = model.latestWeek();
  const val = "Val (In Cr)";

  const plainRow = (key: string, label: string, w: LedgerWindow, opts: { cur?: boolean; muted?: boolean; chg?: number | null; chg2?: number | null } = {}) => (
    <tr key={key} className={opts.cur ? "pl-cur" : undefined}>
      <td className={opts.muted ? "pl-muted" : undefined}>{label}</td>
      <td>
        <Num w={w} />
      </td>
      <td className="pl-c-chg">{opts.chg !== undefined ? <Badge change={opts.chg} /> : null}</td>
      <td className="pl-c-chg">{opts.chg2 !== undefined ? <Badge change={opts.chg2} /> : null}</td>
    </tr>
  );

  const spacer = (key: string) => (
    <tr key={key} className="pl-w-spacer" aria-hidden="true">
      <td colSpan={4} />
    </tr>
  );

  return (
    <section className="pl-panel" aria-label={title}>
      <div className="pl-band">
        {title} <span className="pl-band-unit">{unitLine}</span>
        <label className="pl-band-toggle">
          <input type="checkbox" checked={hideWeekdays} onChange={(e) => setHideWeekdays(e.target.checked)} />
          Hide weekday tables
        </label>
      </div>
      <div className="pl-row">
        <table className="pl-period">
          <colgroup>
            <col className="pl-col-period" />
            <col className="pl-col-val" />
            <col className="pl-col-chg1" />
            <col className="pl-col-chg2" />
          </colgroup>
          <tbody className="pl-sec">
            <HeaderRow cells={[{ text: "Financial Year" }, { text: "Total" }, { text: "YoY %" }, { text: "" }]} />
            {selRows("fy")}
          </tbody>
          <tbody className="pl-sec">
            <HeaderRow cells={[{ text: "Quarter>>" }, { text: val }, { text: "QoQ %" }, { text: "" }]} />
            {selRows("q")}
          </tbody>
          <tbody className="pl-sec">
            <HeaderRow cells={[{ text: "Month>>" }, { text: val }, { text: "MoM %" }, { text: "" }]} />
            {selRows("m")}
            {plainRow("half", `Avg 6M (${LEDGER_WINDOWS.half} days)`, half, { muted: true, chg: ledgerChange(m0.value, half.value) })}
          </tbody>
          <tbody className="pl-sec">
            <HeaderRow
              cells={[
                { text: "Week>>" },
                { text: val },
                { text: "WoW" },
                { text: `vs ${LEDGER_WINDOWS.long}D`, title: `Last ${LEDGER_WINDOWS.week} days vs the last ${LEDGER_WINDOWS.long} days` },
              ]}
            />
            {plainRow("w0", `Last ${LEDGER_WINDOWS.week} Days`, last, {
              cur: true,
              chg: ledgerChange(last.value, prev.value),
              chg2: ledgerChange(last.value, long.value),
            })}
            {plainRow("w1", `Prev ${LEDGER_WINDOWS.week} Days`, prev)}
            {plainRow("w2", `Last ${LEDGER_WINDOWS.mid} Days`, mid)}
            {plainRow("w3", `Last ${LEDGER_WINDOWS.long} Days`, long)}
            {plainRow("w4", "Mon–Fri Avg (Latest)", latestWeek)}
          </tbody>
        </table>

        {!hideWeekdays && (
          <>
            <div className="pl-scroll pl-scroll--weekday">
              <table className="pl-wire pl-wire--weekday">
                <thead>
                  <tr>
                    <th scope="col">Week&gt;&gt;</th>
                    <th scope="col">{val}</th>
                    <th scope="col">Do {LEDGER_WINDOWS.dayShort}D</th>
                    <th scope="col">Do {LEDGER_WINDOWS.dayLong}D</th>
                  </tr>
                </thead>
                <tbody>
                  {LEDGER_WEEKDAYS.flatMap((d, i) => {
                    const x = model.day(d);
                    const rows = [
                      <tr key={`${d}-main`} className="pl-w-main">
                        <th scope="row">{d}</th>
                        <td className="pl-w-val">{formatLedgerInr(x.latest.value)}</td>
                        <DeltaCell change={x.doShort} />
                        <DeltaCell change={x.doLong} />
                      </tr>,
                      <tr key={`${d}-s`} className="pl-w-detail">
                        <td>{`Average of last ${LEDGER_WINDOWS.dayShort} ${d}s`}</td>
                        <td className="pl-w-val">{formatLedgerInr(x.short.value)}</td>
                        <td />
                        <td />
                      </tr>,
                      <tr key={`${d}-l`} className="pl-w-detail">
                        <td>{`Average of last ${LEDGER_WINDOWS.dayLong} ${d}s`}</td>
                        <td className="pl-w-val">{formatLedgerInr(x.long.value)}</td>
                        <td />
                        <td />
                      </tr>,
                    ];
                    return i === 0 ? rows : [spacer(`${d}-sp`), ...rows];
                  })}
                </tbody>
              </table>
            </div>

            <div className="pl-scroll pl-scroll--quarter">
              <table className="pl-wire pl-wire--quarter">
                <thead>
                  <tr>
                    <th scope="col">Quarter</th>
                    <th scope="col">{val}</th>
                    <th scope="col">QoQ</th>
                    <th scope="col">YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {LEDGER_WEEKDAYS.flatMap((d, i) => {
                    const x = model.dayQuarter(d);
                    const latest = model.dayLast(d, 1);
                    const rows = [
                      <tr key={`${d}-main`} className="pl-w-main">
                        <th scope="row">{d}</th>
                        <td className="pl-w-val">{formatLedgerInr(latest.value)}</td>
                        <DeltaCell change={x.qoq} />
                        <DeltaCell change={x.yoy} />
                      </tr>,
                      ...selections.wq[d].map((q, r) => (
                        <tr key={`${d}-q${r}`} className="pl-w-detail">
                          <td className="pl-c-sel">
                            <PeriodSelect
                              labels={model.quarters}
                              value={q}
                              ariaLabel={`${d}, quarter row ${r + 1}`}
                              onChange={(l) => onSelect({ kind: "wq", day: d, row: r }, l)}
                            />
                          </td>
                          <td className="pl-w-val">{formatLedgerInr(model.dayInQuarter(d, q).value)}</td>
                          <td />
                          <td />
                        </tr>
                      )),
                    ];
                    return i === 0 ? rows : [spacer(`${d}-sp`), ...rows];
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
