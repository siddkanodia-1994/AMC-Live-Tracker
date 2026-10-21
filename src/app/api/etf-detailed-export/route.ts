import { NextResponse } from "next/server";
import { Workbook } from "exceljs";
import { getDetailedExportData } from "@/lib/etf/detailed-export";
import { buildEtfDetailedExcelSheet } from "@/lib/etf/detailed-export-excel";
import { getIstDateString } from "@/lib/utils/date";

// Server-side generation (unlike every other export in this app, which
// builds its workbook client-side from already-loaded summary data): this
// export's row count -- up to ~10 AMCs x 2 schemes x 1,000+ daily rows each,
// full history back to each scheme's own first real anchor -- would
// visibly freeze the browser's main thread if built there. exceljs runs
// fine in Node, so the whole workbook is built here and streamed down as
// a finished buffer.
export async function GET() {
  try {
    const groups = await getDetailedExportData(5);
    const workbook = new Workbook();
    for (const group of groups) {
      buildEtfDetailedExcelSheet(workbook, group);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const today = getIstDateString();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Gold_Silver_ETF_Daily_Detail_${today}.xlsx"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to generate Gold/Silver ETF detailed export" }, { status: 500 });
  }
}
