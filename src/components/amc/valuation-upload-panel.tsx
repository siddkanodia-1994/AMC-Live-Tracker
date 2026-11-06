"use client";

import { useRef, useState } from "react";
import { mutate } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ACCORD_CODES, parseValuationRows, type ValuationRow } from "@/lib/valuation/parse-valuation-workbook";
import { formatDayMonthYear } from "@/lib/valuation/bands";
import type { ValuationUploadPreview } from "@/lib/valuation/store";

// Drop the Ace Equity export here to add new dates (and revise any date
// whose value changed). Two steps: the browser parses the file and asks the
// server what WOULD change (nothing is written), then Apply writes it. Open
// to any visitor like the tab's other edit controls -- the server re-checks
// everything, never deletes, and logs every overwritten value.

const COMPANY_BY_SLUG = new Map(Object.values(ACCORD_CODES).map((v) => [v.slug, v.company]));
const FIELD_LABELS: Record<string, string> = { peCons: "PE (cons)", peSa: "PE (standalone)", mcapNsCons: "Mcap/Sales (cons)", mcapNsSa: "Mcap/Sales (standalone)" };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed with status ${res.status}`);
  return json as T;
}

const fmtValue = (v: number | null) => (v === null ? "blank" : v.toFixed(2));

export function ValuationUploadPanel({ lastUpload }: { lastUpload: { sourceFile: string; updatedAt: string } | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"reading" | "applying" | null>(null);
  const [pending, setPending] = useState<{ fileName: string; rows: ValuationRow[]; preview: ValuationUploadPreview; parseErrors: string[] } | null>(null);

  async function handleFile(file: File) {
    setBusy("reading");
    setPending(null);
    try {
      const { read, utils } = await import("xlsx");
      const workbook = read(await file.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const { rows, errors } = parseValuationRows(sheet ? utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null }) : []);
      if (rows.length === 0) {
        toast.error(errors[0] ?? "No rows found in that file.");
        return;
      }
      const preview = await postJson<ValuationUploadPreview>("/api/amc-valuation/preview", { rows });
      setPending({ fileName: file.name, rows, preview, parseErrors: errors });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that file");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleApply() {
    if (!pending) return;
    setBusy("applying");
    try {
      const result = await postJson<ValuationUploadPreview>("/api/amc-valuation/apply", { rows: pending.rows, sourceFile: pending.fileName });
      toast.success(`Saved: ${result.totals.inserts} new date(s), ${result.totals.revisedDates} revised.`);
      setPending(null);
      await mutate((key) => typeof key === "string" && key.startsWith("/api/amc-valuation"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  const nothingToDo = pending && pending.preview.totals.inserts === 0 && pending.preview.totals.revisedDates === 0;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-md border-2 border-dashed px-4 py-3 text-center text-sm transition-colors ${
          dragging ? "border-foreground bg-muted" : "border-border text-muted-foreground hover:bg-muted/50"
        }`}
      >
        {busy === "reading" ? "Reading file…" : "Update PE / Mcap-Sales data: drop the Ace Equity Excel here, or click to choose it"}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {lastUpload && !pending && (
        <p className="text-xs text-muted-foreground">
          Last updated {new Date(lastUpload.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} from {lastUpload.sourceFile}
        </p>
      )}

      {pending && (
        <div className="space-y-3 text-sm">
          <p className="font-semibold">
            {pending.fileName}: {pending.preview.totals.inserts} new date(s), {pending.preview.totals.revisedDates} revised, {pending.preview.totals.unchanged} unchanged.
            Nothing is saved until you click Apply.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-semibold">Company</th>
                <th className="py-1 pr-2 text-right font-semibold">New dates</th>
                <th className="py-1 pr-2 font-semibold">New date span</th>
                <th className="py-1 pr-2 text-right font-semibold">Revised</th>
                <th className="py-1 text-right font-semibold">Unchanged</th>
              </tr>
            </thead>
            <tbody>
              {pending.preview.summary.map((s) => (
                <tr key={s.slug} className="border-b last:border-0">
                  <td className="py-1 pr-2">{COMPANY_BY_SLUG.get(s.slug) ?? s.slug}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{s.inserts}</td>
                  <td className="py-1 pr-2 tabular-nums">
                    {s.firstNewDate ? `${formatDayMonthYear(s.firstNewDate)} – ${formatDayMonthYear(s.lastNewDate!)}` : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{s.revisedDates}</td>
                  <td className="py-1 text-right tabular-nums">{s.unchanged}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pending.preview.revisionCount > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold">
                {pending.preview.revisionCount} changed value(s) will overwrite stored history (old values are kept in the change log)
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs tabular-nums">
                {pending.preview.revisions.map((r) => (
                  <li key={`${r.slug}|${r.date}|${r.field}`}>
                    {COMPANY_BY_SLUG.get(r.slug) ?? r.slug} · {formatDayMonthYear(r.date)} · {FIELD_LABELS[r.field]}: {fmtValue(r.oldValue)} → {fmtValue(r.newValue)}
                  </li>
                ))}
                {pending.preview.revisionCount > pending.preview.revisions.length && (
                  <li className="text-muted-foreground">…and {pending.preview.revisionCount - pending.preview.revisions.length} more</li>
                )}
              </ul>
            </details>
          )}
          {pending.parseErrors.length > 0 && (
            <details className="text-amber-600 dark:text-amber-400">
              <summary className="cursor-pointer text-xs font-semibold">{pending.parseErrors.length} row(s) skipped</summary>
              <ul className="mt-1 list-disc pl-4 text-xs">
                {pending.parseErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleApply} disabled={busy !== null || !!nothingToDo}>
              {busy === "applying" ? "Saving…" : nothingToDo ? "Nothing new to save" : "Apply"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPending(null)} disabled={busy === "applying"}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
