"use client";

import { toast } from "sonner";
import { formatLedgerInr } from "@/lib/aum/period-ledger";
import { getAmcAbbreviation } from "@/lib/aum/amc-names";
import type { AmcAnalyticsField, AmcAnalyticsInputs } from "@/lib/aum/amc-analytics-inputs";
import { revalidateAmcInputs, saveAmcInput, useAmcAnalyticsScore } from "@/hooks/use-amc-analytics-inputs";
import { computeSipGrowth, effectiveSipValues, type SipFive, type SipThirdRowBases } from "@/lib/aum/sip-growth";
import { sipByMonth, thirdRowMonthBases, thirdRowQuarterBases } from "@/lib/aum/industry-sip";
import { useIndustryMonthlyFlows } from "@/hooks/use-industry-monthly-flows";
import { Pct, SavedNumberInput } from "./sections";
import { SipMatrix } from "./sip-matrix";

// SIP & Score: the AMC and industry SIP cards and the AMC Score card, in the
// ledger look. The figures are the same stored ones the Fortnightly AMC
// Update tab shows, so an edit here shows there and the other way round.

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A wide net around the current pick, as on the Fortnightly tab.
function aroundOptions(selected: number): number[] {
  const options: number[] = [];
  for (let v = selected - 10; v <= selected + 5; v++) options.push(v);
  return options;
}

// The industry anchors and estimate switch are shared by all AMCs: refresh
// every AMC's figures (and the Fortnightly tab's copy) after a change.
async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to save");
  }
  await revalidateAmcInputs();
}

function saveShared(body: Record<string, unknown>, url = "/api/sip-industry-override") {
  postJson(url, body).catch((err) => toast.error(err instanceof Error ? err.message : "Failed to save"));
}

function formatAnchorDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}

type SaveField = (field: AmcAnalyticsField, value: number | string | null) => Promise<void>;

function rowTitles(labels: readonly string[]): string[] {
  return [`Latest (${labels[0]})`, `Previous (${labels[1]})`, `Previous (${labels[2]})`, `Last year (${labels[3]})`, `Last year (${labels[4]})`];
}

function labelList(labels: { qtd: string; prevQ: string; prevQ2: string; yoyQ: string; yoyQ2: string }): string[] {
  return [labels.qtd, labels.prevQ, labels.prevQ2, labels.yoyQ, labels.yoyQ2];
}

// SIP / Eq AUM % and SIP share % live in the cross-AMC table below (and
// the % is still typed on the Fortnightly tab's card).
function AmcSipCard({ sheet, editable, saveField }: { sheet: AmcAnalyticsInputs; editable: boolean; saveField: SaveField }) {
  const m = sheet.manual;
  const fields = ["sipAmcQtdValCr", "sipAmcPrevQValCr", "sipAmcPrevQ2ValCr", "sipAmcYoyQValCr", "sipAmcYoyQ2ValCr"] as const;
  const values = fields.map((v) => m[v]) as SipFive;
  const growth = computeSipGrowth(values);
  const titles = rowTitles(labelList(sheet.sipAmcLabels));
  const abbrev = getAmcAbbreviation(sheet.amcId);
  return (
    <section className="pl-panel ss-card">
      <div className="pl-band">
        {abbrev} SIP growth · quarterly <span className="pl-band-unit">₹ Cr · typed in</span>
      </div>
      <div className="ss-anchor">
        <span>Latest quarter</span>
        <select
          className="vm-sel ss-sel"
          aria-label="Latest quarter"
          value={sheet.sipAmcLatestQuarter}
          disabled={!editable}
          onChange={(e) => saveField("sipAmcLatestQuarter", Number(e.target.value)).catch((err) => toast.error(err.message))}
        >
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
        <select
          className="vm-sel ss-sel"
          aria-label="Fiscal year"
          value={sheet.sipAmcLatestFy}
          disabled={!editable}
          onChange={(e) => saveField("sipAmcLatestFy", Number(e.target.value)).catch((err) => toast.error(err.message))}
        >
          {aroundOptions(sheet.sipAmcLatestFy).map((fy) => (
            <option key={fy} value={fy}>
              FY{String(fy).slice(-2)}
            </option>
          ))}
        </select>
      </div>
      <div className="ss-scroll">
        <table className="ss-t">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Val (Cr)</th>
              <th scope="col">QoQ %</th>
              <th scope="col">YoY %</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((valField, i) => (
              <tr key={valField} className={i === 0 ? "ss-cur" : undefined}>
                <th scope="row">{titles[i]}</th>
                <td className={editable ? "ss-in" : undefined}>
                  {editable ? (
                    <SavedNumberInput value={m[valField]} onSave={(x) => saveField(valField, x)} ariaLabel={`${titles[i]} SIP`} decimals={0} grouped />
                  ) : (
                    formatLedgerInr(m[valField])
                  )}
                </td>
                <td className="ss-chg">{i < 2 ? <Pct change={growth.step[i]} /> : null}</td>
                <td className="ss-chg">{i < 2 ? <Pct change={growth.yoy[i]} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IndustrySipCard({
  kind,
  sheet,
  editable,
  saveField,
  effective,
  thirdRowBases,
}: {
  kind: "quarter" | "month";
  sheet: AmcAnalyticsInputs;
  editable: boolean;
  saveField: SaveField;
  effective: SipFive;
  thirdRowBases?: SipThirdRowBases;
}) {
  const isQ = kind === "quarter";
  const m = sheet.manual;
  const fields = isQ
    ? (["sipIndustryQtrQtdValCr", "sipIndustryQtrPrevQValCr", "sipIndustryQtrPrevQ2ValCr", "sipIndustryQtrYoyQValCr", "sipIndustryQtrYoyQ2ValCr"] as const)
    : (["sipIndustryMtdValCr", "sipIndustryPrevMValCr", "sipIndustryPrevM2ValCr", "sipIndustryYoyMValCr", "sipIndustryYoyM2ValCr"] as const);
  const qAuto = sheet.sipIndustryQuarterlyAuto;
  const mAuto = sheet.sipIndustryAuto;
  const auto: SipFive = isQ
    ? [qAuto?.values.qtd ?? null, qAuto?.values.prevQ ?? null, qAuto?.values.prevQ2 ?? null, qAuto?.values.yoyQ ?? null, qAuto?.values.yoyQ2 ?? null]
    : [mAuto?.values.mtd ?? null, mAuto?.values.prevM ?? null, mAuto?.values.prevM2 ?? null, mAuto?.values.yoyM ?? null, mAuto?.values.yoyM2 ?? null];
  const labels = isQ ? qAuto?.labels : mAuto?.labels;
  const estimate = isQ ? qAuto?.estimate : mAuto?.estimate;
  const growth = computeSipGrowth(effective, thirdRowBases);
  const titles = labels ? rowTitles(labelList(labels)) : ["Latest", "Previous", "Previous", "Last year", "Last year"];
  const estimateStep = estimate && effective[0] !== null && effective[0] !== 0 ? estimate.valueCr / effective[0] - 1 : null;

  return (
    <section className="pl-panel ss-card">
      <div className="pl-band">
        Industry SIP growth · {isQ ? "quarterly" : "monthly"} <span className="pl-band-unit">₹ Cr · from AMFI, overridable</span>
      </div>
      <div className="ss-anchor">
        <span>Latest {kind}</span>
        {isQ && qAuto ? (
          <>
            <select
              className="vm-sel ss-sel"
              aria-label="Industry latest quarter"
              value={qAuto.anchorQuarter}
              disabled={!editable}
              onChange={(e) => saveShared({ quarterFy: qAuto.anchorFy, quarter: Number(e.target.value) })}
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
            <select
              className="vm-sel ss-sel"
              aria-label="Industry fiscal year"
              value={qAuto.anchorFy}
              disabled={!editable}
              onChange={(e) => saveShared({ quarterFy: Number(e.target.value), quarter: qAuto.anchorQuarter })}
            >
              {aroundOptions(qAuto.anchorFy).map((fy) => (
                <option key={fy} value={fy}>
                  FY{String(fy).slice(-2)}
                </option>
              ))}
            </select>
          </>
        ) : !isQ && mAuto ? (
          <>
            <select
              className="vm-sel ss-sel"
              aria-label="Industry latest month"
              value={mAuto.anchorMonth}
              disabled={!editable}
              onChange={(e) => saveShared({ month: `${mAuto.anchorYear}-${e.target.value.padStart(2, "0")}` })}
            >
              {MONTH_ABBREV.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="vm-sel ss-sel"
              aria-label="Industry year"
              value={mAuto.anchorYear}
              disabled={!editable}
              onChange={(e) => saveShared({ month: `${e.target.value}-${String(mAuto.anchorMonth).padStart(2, "0")}` })}
            >
              {aroundOptions(mAuto.anchorYear).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span>—</span>
        )}
        <label className="ss-check">
          <input
            type="checkbox"
            checked={Boolean(estimate)}
            disabled={!editable}
            onChange={(e) => saveShared({ enabled: e.target.checked }, "/api/sip-industry-estimate-toggle")}
          />
          Show estimated next {kind}
        </label>
        <span className="ss-shared">Shared setting for every AMC</span>
      </div>
      <div className="ss-scroll">
        <table className="ss-t">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Val (Cr)</th>
              <th scope="col">{isQ ? "QoQ %" : "MoM %"}</th>
              <th scope="col">YoY %</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={f} className={i === 0 ? "ss-cur" : undefined}>
                <th scope="row">{titles[i]}</th>
                <td className={editable ? "ss-in" : undefined}>
                  {editable ? (
                    <SavedNumberInput
                      value={m[f]}
                      onSave={(x) => saveField(f, x)}
                      ariaLabel={`${titles[i]} industry SIP`}
                      decimals={0}
                      placeholder={formatLedgerInr(auto[i])}
                      muted={m[f] === null}
                      grouped
                    />
                  ) : (
                    formatLedgerInr(effective[i])
                  )}
                </td>
                <td className="ss-chg">{i < 2 || (i === 2 && thirdRowBases) ? <Pct change={growth.step[i]} /> : null}</td>
                <td className="ss-chg">{i < 2 || (i === 2 && thirdRowBases) ? <Pct change={growth.yoy[i]} /> : null}</td>
              </tr>
            ))}
            {estimate && (
              <tr className="ss-est">
                <th scope="row">{estimate.label}</th>
                <td>{formatLedgerInr(estimate.valueCr)}</td>
                <td className="ss-chg">
                  <Pct change={estimateStep} />
                </td>
                <td className="ss-chg">
                  <Pct change={estimate.yoyPct} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Loaded on its own (it comes from the external AMC Score project), so the
// SIP cards never wait for it.
function AmcScoreCard({ amcId, editable, saveField }: { amcId: number; editable: boolean; saveField: SaveField }) {
  const { data, error } = useAmcAnalyticsScore(amcId);
  const card = data?.card ?? null;
  const dates = data?.availableDates ?? [];
  return (
    <section className="pl-panel ss-card">
      <div className="pl-band">
        AMC Score <span className="pl-band-unit">weighted score · from the AMC Score project</span>
      </div>
      {card && dates.length > 0 && (
        <div className="ss-anchor">
          <span>Anchor date</span>
          <select
            className="vm-sel ss-sel ss-sel--wide"
            aria-label="AMC Score anchor date"
            value={card.anchorDate}
            disabled={!editable}
            onChange={(e) => saveField("amcScoreAnchorDate", e.target.value).catch((err) => toast.error(err.message))}
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {formatAnchorDate(d)}
              </option>
            ))}
          </select>
        </div>
      )}
      {!data && !error ? (
        <p className="aa-note" style={{ padding: 12, margin: 0 }}>
          Loading the AMC Score…
        </p>
      ) : error ? (
        <p className="aa-note" style={{ padding: 12, margin: 0 }}>
          The AMC Score is unavailable right now.
        </p>
      ) : card ? (
        <table className="ss-t">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Score</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, i) => (
              <tr key={row.label} className={i === 0 ? "ss-cur" : undefined}>
                <th scope="row">{row.label}</th>
                <td className="ss-strong">{row.score === null ? "—" : row.score.toFixed(2)}</td>
                <td className="ss-chg">{row.changePct === null ? <span className="ss-dash">—</span> : <Pct change={row.changePct} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="aa-note" style={{ padding: 12, margin: 0 }}>
          No AMC Score data available for this fund.
        </p>
      )}
    </section>
  );
}

export function SipScoreSection({ slug, inputs }: { slug: string; inputs: AmcAnalyticsInputs | undefined }) {
  const { data: flows } = useIndustryMonthlyFlows();
  const sheetForSlug = inputs && inputs.slug === slug ? inputs : undefined;
  if (!sheetForSlug) {
    return <p className="aa-note">Loading the SIP figures…</p>;
  }
  const s = sheetForSlug;
  const editable = true;

  async function saveField(field: AmcAnalyticsField, value: number | string | null) {
    await saveAmcInput(s.amcId, field, value);
  }

  const m = s.manual;
  const q = s.sipIndustryQuarterlyAuto;
  const mo = s.sipIndustryAuto;
  const industryQ = effectiveSipValues(
    [m.sipIndustryQtrQtdValCr, m.sipIndustryQtrPrevQValCr, m.sipIndustryQtrPrevQ2ValCr, m.sipIndustryQtrYoyQValCr, m.sipIndustryQtrYoyQ2ValCr],
    [q?.values.qtd ?? null, q?.values.prevQ ?? null, q?.values.prevQ2 ?? null, q?.values.yoyQ ?? null, q?.values.yoyQ2 ?? null]
  );
  const industryM = effectiveSipValues(
    [m.sipIndustryMtdValCr, m.sipIndustryPrevMValCr, m.sipIndustryPrevM2ValCr, m.sipIndustryYoyMValCr, m.sipIndustryYoyM2ValCr],
    [mo?.values.mtd ?? null, mo?.values.prevM ?? null, mo?.values.prevM2 ?? null, mo?.values.yoyM ?? null, mo?.values.yoyM2 ?? null]
  );
  // The third row's own QoQ / MoM and YoY compare with periods that aren't
  // on the card, straight from AMFI (an override on the row itself still counts).
  const byMonth = flows ? sipByMonth(flows.points) : null;
  const quarterBases = byMonth && q ? thirdRowQuarterBases(byMonth, { fy: q.anchorFy, q: q.anchorQuarter }) : undefined;
  const monthBases = byMonth && mo ? thirdRowMonthBases(byMonth, mo.anchorYear, mo.anchorMonth) : undefined;

  return (
    <>
      <div className="ss-grid">
        <AmcSipCard sheet={s} editable={editable} saveField={saveField} />
        <IndustrySipCard kind="quarter" sheet={s} editable={editable} saveField={saveField} effective={industryQ} thirdRowBases={quarterBases} />
        <AmcScoreCard amcId={s.amcId} editable={editable} saveField={saveField} />
        <IndustrySipCard kind="month" sheet={s} editable={editable} saveField={saveField} effective={industryM} thirdRowBases={monthBases} />
      </div>
      <p className="aa-note">
        Blue cells save straight away, to the same stored figures the Fortnightly AMC Update tab shows. Grey industry figures come from AMFI; type to override, clear to go back. The industry anchors and the estimate switch are shared
        settings that change every AMC&apos;s cards.
      </p>
      <SipMatrix slug={slug} />
    </>
  );
}
