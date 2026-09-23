"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminFetch } from "@/lib/admin-client";
import { formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";

interface WeekendPriceAnomaly {
  isin: string;
  overviewName: string;
  snapshotDate: string;
  priceInr: number;
}

/**
 * Read-only detection card -- see weekend-price-anomalies.ts for what this
 * flags (a listed-stock AMC's share price with a Sat/Sun row and no
 * matching AUM snapshot that day) and why (added after the 2026-09-19
 * stray-row audit; a genuine special trading session, e.g. Budget day,
 * always has a matching AUM row, so this only catches the other case).
 * Detection only -- no delete action here, by design; verify a flagged
 * row isn't a real special session before removing it.
 */
export function WeekendPriceAnomalies({ secret }: { secret: string }) {
  const [anomalies, setAnomalies] = useState<WeekendPriceAnomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/weekend-price-anomalies", secret);
      if (!res.ok) throw new Error("Failed to check");
      const data: { anomalies: WeekendPriceAnomaly[] } = await res.json();
      setAnomalies(data.anomalies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch, same pattern as sync-actions.tsx's refreshShareAdjustments
    refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekend price anomalies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Flags a listed-stock AMC&apos;s share price row dated a Saturday/Sunday with no matching AUM
          snapshot that day -- a real special trading session (Budget day, Diwali Muhurat, a DR-site test)
          always has a matching AUM row, so this only catches a stray/duplicate price row on a day nothing
          else recognizes as a trading day.
        </p>
        <Button onClick={refresh} disabled={loading} size="sm" variant="outline">
          {loading ? "Checking..." : "Refresh"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && anomalies.length === 0 && (
          <p className="text-sm text-muted-foreground">No weekend price anomalies found.</p>
        )}
        {anomalies.length > 0 && (
          <ul className="space-y-2 text-sm">
            {anomalies.map((a) => (
              <li key={`${a.isin}-${a.snapshotDate}`} className="rounded-md border px-3 py-2">
                <span className="font-medium">{a.overviewName}</span>{" "}
                <span className="text-muted-foreground">
                  {formatShortDateWithYear(a.snapshotDate)} — {formatPriceInr(a.priceInr)}, no matching AUM entry
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
