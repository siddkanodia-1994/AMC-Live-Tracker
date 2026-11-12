"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useIndustryMonthlyFlows } from "@/hooks/use-industry-monthly-flows";
import { fiscalQuarterOf, quarterSip, sipByMonth, type FiscalQuarter } from "@/lib/aum/industry-sip";
import { formatLedgerInr } from "@/lib/aum/period-ledger";
import { matrixQuarters, yoyOfLatest, type SipQuarterValue } from "@/lib/aum/sip-quarterly-matrix";
import { Pct } from "./sections";

// SIP & Score's cross-AMC table: every listed AMC's SIP / Eq AUM % and SIP
// share % by quarter, Q1FY25 onward, as a heatmap (each row shaded by its
// own range). Read-only: figures are typed on the SIP cards (and older
// quarters came from a one-off backfill).

interface MatrixAmc {
  amcId: number;
  slug: string;
  name: string;
  quarters: Record<string, SipQuarterValue>;
}

export const SIP_MATRIX_KEY = "/api/sip-quarterly";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  return res.json();
}

// The AMC tabs' order.
const ORDER = [
  "hdfc-mutual-fund",
  "icici-prudential-mutual-fund",
  "sbi-mutual-fund",
  "nippon-india-mutual-fund",
  "aditya-birla-sun-life-mutual-fund",
  "uti-mutual-fund",
  "canara-robeco-mutual-fund",
  "motilal-oswal-mutual-fund",
];

const pct1 = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

// Deeper green = higher, within the row's own range.
function heatStyle(values: (number | null)[], v: number | null): React.CSSProperties | undefined {
  const xs = values.filter((x): x is number => x !== null);
  if (v === null || xs.length < 2) return undefined;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
  return { background: `rgba(8, 113, 30, ${(0.06 + t * 0.32).toFixed(2)})` };
}

function Matrix({
  title,
  unit,
  quarters,
  rows,
  slug,
  industry,
}: {
  title: string;
  unit: string;
  quarters: { key: string; label: string }[];
  rows: { slug: string; name: string; values: (number | null)[] }[];
  slug: string;
  industry?: (number | null)[];
}) {
  return (
    <section className="pl-panel" aria-label={title}>
      <div className="pl-band">
        {title} <span className="pl-band-unit">{unit}</span>
      </div>
      <div className="ss-scroll">
        <table className="sm-t" style={{ minWidth: 150 + quarters.length * 72 + 84 }}>
          <thead>
            <tr>
              <th scope="col">AMC</th>
              {quarters.map((q) => (
                <th key={q.key} scope="col">
                  {q.label}
                </th>
              ))}
              <th scope="col" className="sm-chg">
                YoY
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className={r.slug === slug ? "sm-sel" : undefined}>
                <th scope="row">{r.name}</th>
                {r.values.map((v, i) => (
                  <td key={quarters[i].key} className={`${i === r.values.length - 1 ? "sm-cur" : ""}${v === null ? " sm-none" : ""}`} style={heatStyle(r.values, v)}>
                    {pct1(v)}
                  </td>
                ))}
                <td className="sm-chg">
                  <Pct change={yoyOfLatest(r.values)} />
                </td>
              </tr>
            ))}
            {industry && (
              <tr className="sm-ind">
                <th scope="row">Industry SIP ₹ Cr</th>
                {industry.map((v, i) => (
                  <td key={quarters[i].key}>{formatLedgerInr(v)}</td>
                ))}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SipMatrix({ slug }: { slug: string }) {
  const { data } = useSWR<{ amcs: MatrixAmc[] }>(SIP_MATRIX_KEY, fetchJson, { revalidateOnFocus: false });
  const { data: flows } = useIndustryMonthlyFlows();

  const view = useMemo(() => {
    if (!data || !flows) return null;
    const byMonth = sipByMonth(flows.points);
    const months = [...byMonth.keys()].sort();
    // Through the latest quarter anyone has a figure for (AMFI or an AMC).
    const index = ({ fy, q }: FiscalQuarter) => fy * 4 + q;
    let last: FiscalQuarter = months.length ? fiscalQuarterOf(months[months.length - 1]) : { fy: 2025, q: 1 };
    for (const a of data.amcs) {
      for (const [k, v] of Object.entries(a.quarters)) {
        if (v.sipCr === null && v.sipEqAumPct === null) continue;
        const [fy, q] = k.split("-").map(Number);
        if (index({ fy, q }) > index(last)) last = { fy, q };
      }
    }
    const quarters = matrixQuarters(last);
    const industry = quarters.map((q) => quarterSip(byMonth, q.quarter));
    const amcs = [...data.amcs].sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));
    const pctRows = amcs.map((a) => ({ slug: a.slug, name: a.name, values: quarters.map((q) => a.quarters[q.key]?.sipEqAumPct ?? null) }));
    const shareRows = amcs.map((a) => ({
      slug: a.slug,
      name: a.name,
      values: quarters.map((q, i) => {
        const sip = a.quarters[q.key]?.sipCr ?? null;
        const ind = industry[i];
        return sip !== null && ind ? sip / ind : null;
      }),
    }));
    return { quarters, industry, pctRows, shareRows };
  }, [data, flows]);

  if (!view) return <p className="aa-note">Loading the SIP history…</p>;
  return (
    <div className="sm-view">
      <Matrix title="SIP / Eq AUM % · all AMCs" unit="quarterly · shade = each row's own range" quarters={view.quarters} rows={view.pctRows} slug={slug} />
      <Matrix
        title="SIP share % · all AMCs"
        unit="AMC SIP ÷ AMFI industry SIP, same quarter"
        quarters={view.quarters}
        rows={view.shareRows}
        slug={slug}
        industry={view.industry}
      />
      <p className="aa-note">
        SIP ₹ Cr is typed on the SIP card above and SIP / Eq AUM % on the Fortnightly tab&apos;s card (the latest 5 quarters); older quarters were
        filled in once from your sheet. SIP share needs the
        AMC&apos;s SIP ₹ Cr for that quarter, so it&apos;s blank where only the % was entered. YoY compares the latest quarter with the same quarter a
        year earlier. The selected AMC&apos;s row is outlined.
      </p>
    </div>
  );
}
