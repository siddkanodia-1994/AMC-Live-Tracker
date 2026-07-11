import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { importWorkbook } from "@/lib/excel/import-workbook";
import { invalidateLiveAumCache } from "@/lib/aum/cache";

export const maxDuration = 60;

export const POST = withAdminAuth(async (request: Request) => {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a multipart 'file' field" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importWorkbook(buffer, file.name);

  invalidateLiveAumCache();

  return NextResponse.json(result);
});
