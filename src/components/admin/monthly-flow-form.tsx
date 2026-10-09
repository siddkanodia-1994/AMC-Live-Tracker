"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminFetch } from "@/lib/admin-client";

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
}

// Feeds the Summary tab's "Industry Flows" panel -- a single new month at a
// time (month, SIP cr, Net Flow cr); Bulk Flows is always netFlow - sip, so
// there's nothing to enter for it, just a live preview before submit.
export function MonthlyFlowForm({ secret }: { secret: string }) {
  const [monthInput, setMonthInput] = useState("");
  const [sipInput, setSipInput] = useState("");
  const [netFlowInput, setNetFlowInput] = useState("");
  const [saving, setSaving] = useState(false);

  const sip = Number(sipInput);
  const netFlow = Number(netFlowInput);
  const bulkPreview = Number.isFinite(sip) && Number.isFinite(netFlow) && sipInput !== "" && netFlowInput !== ""
    ? netFlow - sip
    : null;

  async function handleSubmit() {
    if (!monthInput) {
      toast.error("Choose a month");
      return;
    }
    if (!Number.isFinite(sip) || !Number.isFinite(netFlow)) {
      toast.error("SIP contributions and Net Flows must be numbers");
      return;
    }
    setSaving(true);
    try {
      const monthEndDate = lastDayOfMonth(monthInput);
      const res = await adminFetch("/api/admin/industry-monthly-flow", secret, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthEndDate, sipContributionsCr: sip, equityNetFlowsCr: netFlow }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      const result = await res.json();
      toast.success(
        `Saved ${monthEndDate}: SIP ₹${sip.toLocaleString("en-IN")} cr, Net Flow ₹${netFlow.toLocaleString("en-IN")} cr, Bulk ₹${result.equityBulkFlowsCr.toLocaleString("en-IN")} cr`
      );
      setMonthInput("");
      setSipInput("");
      setNetFlowInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Industry monthly flows</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Add one month&apos;s AMFI SIP Contributions and Equity Net Flows (INR crore) for the Summary
          tab&apos;s Industry Flows panel. Bulk Flows is computed automatically as Net Flows &minus; SIP. Re-adding
          the same month overwrites it.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="flow-month" className="text-xs text-muted-foreground">Month</label>
            <input
              id="flow-month"
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="flow-sip" className="text-xs text-muted-foreground">SIP Contributions (cr)</label>
            <input
              id="flow-sip"
              type="number"
              value={sipInput}
              onChange={(e) => setSipInput(e.target.value)}
              className="w-36 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="flow-net" className="text-xs text-muted-foreground">Net Flows (cr)</label>
            <input
              id="flow-net"
              type="number"
              value={netFlowInput}
              onChange={(e) => setNetFlowInput(e.target.value)}
              className="w-36 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Bulk Flows (preview)</span>
            <span className="py-1 text-sm tabular-nums">
              {bulkPreview === null ? "—" : `₹${bulkPreview.toLocaleString("en-IN")} cr`}
            </span>
          </div>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
