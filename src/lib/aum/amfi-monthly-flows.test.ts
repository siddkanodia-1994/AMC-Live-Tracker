import { describe, expect, it, vi } from "vitest";
import {
  findMonthlyNoteUrl,
  monthEndDate,
  monthlyReportUrl,
  parseMonthlyNoteSip,
  parseMonthlyReportEquityNet,
  planIngestion,
  runAmfiMonthlyFlowIngestion,
  targetMonthFor,
  type FlowRow,
} from "./amfi-monthly-flows";

const OCT = { year: 2026, month: 10 };

// Shapes of AMFI's own files (October 2026), trimmed to what the parsers read.
const NOTE_TEXT =
  "AMFI monthly note October 2026 2 Industry snapshot • Assets under management ... SIP trend • Monthly contribution under " +
  "systematic investment plans (SIPs) stood at Rs 32,160 crore in October ... SIP monthly contribution (crore) 32,160 32,490 " +
  "32,297 31,961 31,781 30,954 31,115 SIP AUM (lakh crore) 17.2 17.0";

const LISTING_HTML =
  '<p class="x">November 2026</p><div>coming soon</div>' +
  '<p class="x">October 2026</p><div><a href="https://www.amfiindia.com/uploads/AMFI_Monthly_Note_October2026_cd03bc1103.pdf">PDF</a></div>' +
  '<p class="x">September 2026</p><div><a href="/uploads/AMFI_Monthly_Note_September2026_554f6604b6.pdf">PDF</a></div>';

const NET = "Net Inflow (+ve)/Outflow (-ve) for the month of October 2026 (INR in crore)";
const REPORT_ROWS: unknown[][] = [
  ["Sr", "Scheme Name", "No. of Schemes", "No. of Folios", "Funds Mobilized", "Repurchase", NET],
  ["II", "Equity Schemes", null, null, null, null, null],
  ["ii", "Large Cap Fund", 35, 16929204, 4338.74, 3306.35, 1032.3917404],
  ["", "Sub Total - II", 584, 191937225, 65581.36, 32587.72, 32993.63726012001],
  ["", "Sub Total - III", 191, 22980835, 34113.53, 30599.47, 3514.05],
  ["II", "Growth/Equity Oriented Schemes", null, null, null, null, null],
  ["", "Sub Total II", 13, 243456, 0, 8.71, -8.70962204],
];

const STORED: FlowRow[] = [
  ["2026-04-30", 31115], ["2026-05-31", 30954], ["2026-06-30", 31781], ["2026-07-31", 31961], ["2026-08-31", 32297], ["2026-09-30", 32490],
].map(([d, v]) => ({ monthEndDate: d as string, sipContributionsCr: v as number, equityNetFlowsCr: 30000 }));

describe("dates and URLs", () => {
  it("targets the previous calendar month", () => {
    expect(targetMonthFor("2026-11-12")).toEqual(OCT);
    expect(targetMonthFor("2027-01-09")).toEqual({ year: 2026, month: 12 });
    expect(monthEndDate({ year: 2026, month: 2 })).toBe("2026-02-28");
    expect(monthEndDate(OCT)).toBe("2026-10-31");
  });

  it("builds the Monthly Report XLS URL", () => {
    expect(monthlyReportUrl(OCT)).toBe("https://portal.amfiindia.com/spages/amoct2026repo.xls");
  });
});

describe("findMonthlyNoteUrl", () => {
  it("takes the link under the month's own label", () => {
    expect(findMonthlyNoteUrl(LISTING_HTML, OCT)).toBe("https://www.amfiindia.com/uploads/AMFI_Monthly_Note_October2026_cd03bc1103.pdf");
    expect(findMonthlyNoteUrl(LISTING_HTML, { year: 2026, month: 9 })).toBe(
      "https://www.amfiindia.com/uploads/AMFI_Monthly_Note_September2026_554f6604b6.pdf"
    );
  });

  it("never borrows the next month's link", () => {
    expect(findMonthlyNoteUrl(LISTING_HTML, { year: 2026, month: 11 })).toBeNull();
    expect(findMonthlyNoteUrl(LISTING_HTML, { year: 2026, month: 12 })).toBeNull();
  });
});

describe("parseMonthlyNoteSip", () => {
  it("reads the month's SIP and the six before it", () => {
    expect(parseMonthlyNoteSip(NOTE_TEXT, OCT)).toEqual({ sipCr: 32160, previous: [32490, 32297, 31961, 31781, 30954, 31115] });
  });

  it("refuses a note for another month", () => {
    expect(() => parseMonthlyNoteSip(NOTE_TEXT, { year: 2026, month: 9 })).toThrow(/is for October 2026/);
  });

  it("refuses when the row and the summary disagree", () => {
    expect(() => parseMonthlyNoteSip(NOTE_TEXT.replace("Rs 32,160 crore", "Rs 31,160 crore"), OCT)).toThrow(/disagrees/);
  });

  it("refuses when the row is missing", () => {
    expect(() => parseMonthlyNoteSip(NOTE_TEXT.replace("SIP monthly contribution", "SIP inflow"), OCT)).toThrow(/row not found/);
  });
});

describe("parseMonthlyReportEquityNet", () => {
  it("reads the open-ended equity Sub Total - II net inflow, to 2 decimals", () => {
    expect(parseMonthlyReportEquityNet(REPORT_ROWS, OCT)).toBe(32993.64);
  });

  it("refuses a report for another month", () => {
    expect(() => parseMonthlyReportEquityNet(REPORT_ROWS, { year: 2026, month: 9 })).toThrow(/not for September 2026/);
  });

  it("refuses when the equity total is missing rather than reading Sub Total - III", () => {
    const rows = REPORT_ROWS.filter((r) => r[1] !== "Sub Total - II");
    expect(() => parseMonthlyReportEquityNet(rows, OCT)).toThrow(/row not found/);
  });
});

describe("planIngestion", () => {
  const sip = { sipCr: 32160, previous: [32490, 32297, 31961, 31781, 30954, 31115] };

  it("writes the new month with no revisions when history agrees", () => {
    expect(planIngestion(OCT, sip, 32993.64, STORED)).toEqual({
      write: { monthEndDate: "2026-10-31", sipContributionsCr: 32160, equityNetFlowsCr: 32993.64 },
      revisions: [],
    });
  });

  it("picks up a revised earlier month and keeps its stored equity", () => {
    const revised = { ...sip, previous: [32510, ...sip.previous.slice(1)] };
    expect(planIngestion(OCT, revised, 32993.64, STORED).revisions).toEqual([
      { monthEndDate: "2026-09-30", fromCr: 32490, toCr: 32510, equityNetFlowsCr: 30000 },
    ]);
  });

  it("refuses a SIP far from the stored previous month", () => {
    expect(() => planIngestion(OCT, { ...sip, sipCr: 3216 }, 32993.64, STORED)).toThrow(/more than 15%/);
  });
});

describe("runAmfiMonthlyFlowIngestion", () => {
  function fakeFetch(map: Record<string, { status: number; body?: string }>) {
    return vi.fn(async (url: string | URL | Request) => {
      const hit = map[String(url)] ?? { status: 404 };
      return new Response(hit.body ?? "", { status: hit.status });
    }) as unknown as typeof fetch;
  }
  const deps = (over: Partial<Parameters<typeof runAmfiMonthlyFlowIngestion>[0]> = {}) => {
    const upsert = vi.fn(async () => {});
    return {
      upsert,
      args: {
        istDate: "2026-11-12",
        existing: async () => STORED,
        upsert,
        readRows: () => REPORT_ROWS,
        extractPdfText: async () => NOTE_TEXT,
        fetchImpl: fakeFetch({
          [monthlyReportUrl(OCT)]: { status: 200, body: "xls" },
          "https://www.amfiindia.com/otherdata/amfi-monthlynote": { status: 200, body: LISTING_HTML },
          "https://www.amfiindia.com/uploads/AMFI_Monthly_Note_October2026_cd03bc1103.pdf": { status: 200, body: "pdf" },
        }),
        ...over,
      },
    };
  };

  it("writes the month once both files are out", async () => {
    const { upsert, args } = deps();
    const r = await runAmfiMonthlyFlowIngestion(args);
    expect(r.status).toBe("written");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({ monthEndDate: "2026-10-31", sipContributionsCr: 32160, equityNetFlowsCr: 32993.64 });
  });

  it("dry run parses but never writes", async () => {
    const { upsert, args } = deps({ dryRun: true });
    expect((await runAmfiMonthlyFlowIngestion(args)).summary).toMatch(/^\[dry run\] October 2026: SIP 32160/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does nothing when the month is already stored, or before the 8th", async () => {
    const stored = deps({ existing: async () => [...STORED, { monthEndDate: "2026-10-31", sipContributionsCr: 1, equityNetFlowsCr: 1 }] });
    expect((await runAmfiMonthlyFlowIngestion(stored.args)).status).toBe("up-to-date");
    const early = deps({ istDate: "2026-11-05" });
    expect((await runAmfiMonthlyFlowIngestion(early.args)).status).toBe("too-early");
    expect(early.args.fetchImpl).not.toHaveBeenCalled();
  });

  it("waits quietly while AMFI hasn't published the report or the note", async () => {
    const noReport = deps({ fetchImpl: fakeFetch({}) });
    expect((await runAmfiMonthlyFlowIngestion(noReport.args)).status).toBe("not-published");
    const noNote = deps({
      fetchImpl: fakeFetch({
        [monthlyReportUrl(OCT)]: { status: 200, body: "xls" },
        "https://www.amfiindia.com/otherdata/amfi-monthlynote": { status: 200, body: LISTING_HTML.replace(/October 2026/g, "Octo") },
      }),
    });
    expect((await runAmfiMonthlyFlowIngestion(noNote.args)).summary).toMatch(/Monthly Note not out yet/);
    expect(noNote.upsert).not.toHaveBeenCalled();
  });

  it("writes revisions too and flags them as a warning", async () => {
    const { upsert, args } = deps({ extractPdfText: async () => NOTE_TEXT.replace("32,160 32,490", "32,160 32,510") });
    const r = await runAmfiMonthlyFlowIngestion(args);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith({ monthEndDate: "2026-09-30", sipContributionsCr: 32510, equityNetFlowsCr: 30000 });
    expect(r.warnings?.[0]).toMatch(/2026-09 32490→32510/);
  });
});
