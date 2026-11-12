"use client";

import { toast } from "sonner";
import { mutate as globalMutate } from "swr";
import { formatLedgerInr } from "@/lib/aum/period-ledger";
import { getAmcAbbreviation, type FortnightlyFieldName, type FortnightlySheet } from "@/lib/aum/fortnightly-update";
import { computeSipGrowth, computeSipShare, effectiveSipValues, type SipFive, type SipThirdRowBases } from "@/lib/aum/sip-growth";
import { sipByMonth, thirdRowMonthBases, thirdRowQuarterBases } from "@/lib/aum/industry-sip";
import { useIndustryMonthlyFlows } from "@/hooks/use-industry-monthly-flows";
import { Pct, SavedNumberInput } from "./sections";
import { SIP_MATRIX_KEY, SipMatrix } from "./sip-matrix";

// SIP & Score: the Fortnightly AMC Update tab's three SIP cards and its AMC
// Score card, in the ledger look. Same sheet, same save routes, so an edit
// here shows on the Fortnightly tab and the other way round.

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A wide net around the current pick, as on the Fortnightly tab.
function aroundOptions(selected: number): number[] {
  const options: number[] = [];
  for (let v = selected - 10; v <= selected + 5; v++) options.push(v);
  return options;
}

// Every cached Fortnightly sheet: the anchors and estimate switch are
// shared by all AMCs, and the Fortnightly tab holds its own copy.
function revalidateFortnightlySheets() {
  // The cross-AMC SIP table reads the same card figures.
  globalMutate(SIP_MATRIX_KEY);
  return globalMutate((key) => typeof key === "string" && key.startsWith("/api/fortnightly-update?"), undefined, { revalidate: true });
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to save");
  }
  await revalidateFortnightlySheets();
}

function saveShared(body: Record<string, unknown>, url = "/api/sip-industry-override") {
  postJson(url, body).catch((err) => toast.error(err instanceof Error ? err.message : "Failed to save"));
}

function formatAnchorDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}

const pct1 = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

type SaveField = (field: FortnightlyFieldName, value: number | string | null) => Promise<void>;

function rowTitles(labels: readonly string[]): string[] {
  return [`Latest (${labels[0]})`, `Previous (${labels[1]})`, `Previous (${labels[2]})`, `Last year (${labels[3]})`, `Last year (${labels[4]})`];
}

function labelList(labels: { qtd: string; prevQ: string; prevQ2: string; yoyQ: string; yoyQ2: string }): string[] {
  return [labels.qtd, labels.prevQ, labels.prevQ2, labels.yoyQ, labels.yoyQ2];
}

function AmcSipCard({ sheet, editable, saveField, share }: { sheet: FortnightlySheet; editable: boolean; saveField: SaveField; share: SipFive }) {
  const m = sheet.manual;
  const fields = [
    ["sipAmcQtdValCr", "sipAmcQtdPct"],
    ["sipAmcPrevQValCr", "sipAmcPrevQPct"],
    ["sipAmcPrevQ2ValCr", "sipAmcPrevQ2Pct"],
    ["sipAmcYoyQValCr", "sipAmcYoyQPct"],
    ["sipAmcYoyQ2ValCr", "sipAmcYoyQ2Pct"],
  ] as const;
  const values = fields.map(([v]) => m[v]) as SipFive;
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
        <table className="ss-t ss-t--amc">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Val (Cr)</th>
              <th scope="col">QoQ %</th>
              <th scope="col">YoY %</th>
              <th scope="col">SIP / Eq AUM %</th>
              <th scope="col">SIP share %</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(([valField, pctField], i) => (
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
                <td className={editable ? "ss-in" : undefined}>
                  {editable ? (
                    <SavedNumberInput
                      value={m[pctField]}
                      onSave={(x) => saveField(pctField, x)}
                      ariaLabel={`${titles[i]} SIP as % of equity AUM`}
                      decimals={2}
                      scale={100}
                    />
                  ) : (
                    pct1(m[pctField])
                  )}
                </td>
                <td className="ss-share">{pct1(share[i])}</td>
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
  sheet: FortnightlySheet;
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

function AmcScoreCard({ sheet, editable, saveField }: { sheet: FortnightlySheet; editable: boolean; saveField: SaveField }) {
  const card = sheet.amcScore;
  const dates = sheet.amcScoreAvailableDates;
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
      {card ? (
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

export function SipScoreSection({ slug, sheet }: { slug: string; sheet: FortnightlySheet | undefined }) {
  const { data: flows } = useIndustryMonthlyFlows();
  const sheetForSlug = sheet && sheet.slug === slug ? sheet : undefined;
  if (!sheetForSlug) {
    return <p className="aa-note">Loading the Fortnightly figures…</p>;
  }
  const s = sheetForSlug;
  const editable = s.isLatest;

  async function saveField(field: FortnightlyFieldName, value: number | string | null) {
    await postJson("/api/fortnightly-update", { amcId: s.amcId, asOfDate: s.asOfDate, field, value });
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
  const amcLabels = labelList(s.sipAmcLabels);
  const industryLabels = q ? labelList(q.labels) : null;
  const share = computeSipShare(
    [m.sipAmcQtdValCr, m.sipAmcPrevQValCr, m.sipAmcPrevQ2ValCr, m.sipAmcYoyQValCr, m.sipAmcYoyQ2ValCr],
    amcLabels,
    industryQ,
    industryLabels
  );
  const quartersDiffer = industryLabels !== null && industryLabels[0] !== amcLabels[0];
  // The third row's own QoQ / MoM and YoY compare with periods that aren't
  // on the card, straight from AMFI (an override on the row itself still counts).
  const byMonth = flows ? sipByMonth(flows.points) : null;
  const quarterBases = byMonth && q ? thirdRowQuarterBases(byMonth, { fy: q.anchorFy, q: q.anchorQuarter }) : undefined;
  const monthBases = byMonth && mo ? thirdRowMonthBases(byMonth, mo.anchorYear, mo.anchorMonth) : undefined;

  return (
    <>
      <div className="ss-grid">
        <AmcSipCard sheet={s} editable={editable} saveField={saveField} share={share} />
        <IndustrySipCard kind="quarter" sheet={s} editable={editable} saveField={saveField} effective={industryQ} thirdRowBases={quarterBases} />
        <IndustrySipCard kind="month" sheet={s} editable={editable} saveField={saveField} effective={industryM} thirdRowBases={monthBases} />
        <AmcScoreCard sheet={s} editable={editable} saveField={saveField} />
      </div>
      {quartersDiffer && (
        <p className="aa-warn" style={{ padding: 0, marginTop: 10 }}>
          SIP share needs the same quarter on both quarterly cards: {getAmcAbbreviation(s.amcId)} is on {amcLabels[0]}, the industry card on{" "}
          {industryLabels?.[0]}.
        </p>
      )}
      <p className="aa-note">
        {editable
          ? "Blue cells save to the latest Fortnightly AMC Update snapshot, so this tab and the Fortnightly tab always show the same numbers."
          : "Showing a past Fortnightly snapshot: inputs are read-only here."}{" "}
        Grey industry figures come from AMFI; type to override, clear to go back. The industry anchors and the estimate switch are shared
        settings that change every AMC&apos;s cards. SIP share is the AMC&apos;s SIP ÷ industry SIP for the same quarter.
      </p>
      <SipMatrix slug={slug} />
    </>
  );
}
