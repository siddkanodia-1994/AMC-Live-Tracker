"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminFetch } from "@/lib/admin-client";

interface ImportResult {
  reportPeriod: string;
  amcsImported: number;
  holdingsImported: number;
  warnings: string[];
}

interface SyncResult {
  upserted: number;
  unmatchedIsins: string[];
}

interface ReclaimResult {
  reportPeriod: string;
  fromDate: string;
  toDate: string;
  nothingToReclaim: boolean;
  instrumentSync: SyncResult | null;
  displacedRowsDeleted: number;
  backfill: { tradingDatesFound: number; canonicalRowsInserted: number } | null;
  dailyDataQualityDatesProcessed: number;
  warnings: string[];
}

interface ShareAdjustment {
  isin: string;
  reportPeriod: string;
  companyName: string;
  effectiveMultiplier: number;
  firstDetectedOn: string;
  lastPriceBeforeInr: number;
  lastPriceAfterInr: number;
}

function formatSplitRatio(multiplier: number): string {
  return multiplier >= 1 ? `×${multiplier.toFixed(1)}` : `÷${(1 / multiplier).toFixed(1)}`;
}

export function SyncActions({ secret }: { secret: string }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
  const [reclaimResult, setReclaimResult] = useState<ReclaimResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [muteThresholdInput, setMuteThresholdInput] = useState("");
  const [savingMuteThreshold, setSavingMuteThreshold] = useState(false);

  const [detectDateInput, setDetectDateInput] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [shareAdjustments, setShareAdjustments] = useState<ShareAdjustment[]>([]);
  const [dismissingIsin, setDismissingIsin] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [isDismissingAdjustment, setIsDismissingAdjustment] = useState(false);

  function refreshShareAdjustments() {
    adminFetch("/api/admin/share-adjustments", secret)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { adjustments: ShareAdjustment[] } | null) => {
        if (body) setShareAdjustments(body.adjustments);
      })
      .catch(() => {});
  }

  useEffect(() => {
    adminFetch("/api/admin/last-close-mute-threshold", secret)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { thresholdDays: number } | null) => {
        if (body) setMuteThresholdInput(String(body.thresholdDays));
      })
      .catch(() => {});
    refreshShareAdjustments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDetectShareAdjustments() {
    setDetecting(true);
    try {
      const res = await adminFetch("/api/admin/detect-share-adjustments", secret, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detectDateInput ? { date: detectDateInput } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Detection failed");
      }
      const result: { date: string; detectedCount: number } = await res.json();
      toast.success(
        result.detectedCount > 0
          ? `Detected ${result.detectedCount} split/bonus event${result.detectedCount === 1 ? "" : "s"} for ${result.date}`
          : `No new split/bonus events found for ${result.date}`
      );
      refreshShareAdjustments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  async function handleDismissShareAdjustment(isin: string, reportPeriod: string) {
    const reason = dismissReason.trim();
    if (!reason) return;
    setIsDismissingAdjustment(true);
    try {
      const res = await adminFetch("/api/admin/dismiss-share-adjustment", secret, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isin, reportPeriod, reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Reverse failed");
      }
      toast.success("Adjustment reversed");
      setDismissingIsin(null);
      setDismissReason("");
      refreshShareAdjustments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reverse failed");
    } finally {
      setIsDismissingAdjustment(false);
    }
  }

  async function handleSaveMuteThreshold() {
    const thresholdDays = Number(muteThresholdInput);
    if (!Number.isInteger(thresholdDays) || thresholdDays < 1) {
      toast.error("Enter a whole number of 1 or more");
      return;
    }
    setSavingMuteThreshold(true);
    try {
      const res = await adminFetch("/api/admin/last-close-mute-threshold", secret, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdDays }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      toast.success(`Auto-mute threshold set to ${thresholdDays} trading day${thresholdDays === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingMuteThreshold(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await adminFetch("/api/admin/sync-instruments", secret, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Sync failed");
      }
      const result: SyncResult = await res.json();
      setSyncResult(result);
      toast.success(`Synced ${result.upserted} instrument mappings`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await adminFetch("/api/admin/upload", secret, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      const result: ImportResult = await res.json();
      setImportResult(result);
      toast.success(`Imported ${result.amcsImported} AMCs for ${result.reportPeriod}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleReclaim() {
    setReclaiming(true);
    setReclaimResult(null);
    try {
      const res = await adminFetch("/api/admin/reclaim-forward-gap", secret, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Recalculation failed");
      }
      const result: ReclaimResult = await res.json();
      setReclaimResult(result);
      if (result.nothingToReclaim) {
        toast.success("Nothing to reclaim — forward gap already up to date.");
      } else {
        toast.success(`Recalculated ${result.fromDate} to ${result.toDate} for ${result.reportPeriod}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recalculation failed");
    } finally {
      setReclaiming(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>DHAN instrument master</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Re-download DHAN&apos;s instrument list and refresh ISIN → security ID mappings for every
            priceable holding. Run weekly, or after importing a new month&apos;s file.
          </p>
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync instrument master"}
          </Button>
          {syncResult && (
            <div className="text-sm">
              <p>{syncResult.upserted} ISINs mapped.</p>
              {syncResult.unmatchedIsins.length > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  {syncResult.unmatchedIsins.length} priceable ISINs had no match.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload Excel tracker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload a new month&apos;s tracker file. Re-uploading the same month overwrites it; other
            months are kept as history.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
            className="text-sm"
          />
          {importResult && (
            <div className="text-sm">
              <p>
                {importResult.amcsImported} AMCs, {importResult.holdingsImported} holdings imported for{" "}
                {importResult.reportPeriod}.
              </p>
              {importResult.warnings.length > 0 && (
                <details className="text-amber-600 dark:text-amber-400">
                  <summary>{importResult.warnings.length} warning(s)</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {importResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recalculate live AUM through today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            After uploading a new month, the days already elapsed since the 1st are still priced off
            the previous month&apos;s holdings until this runs. Syncs instruments, then reclaims those
            days for the current period. Safe to re-run — a no-op if already up to date.
          </p>
          <Button onClick={handleReclaim} disabled={reclaiming}>
            {reclaiming ? "Recalculating..." : "Recalculate live AUM through today"}
          </Button>
          {reclaimResult && (
            <div className="text-sm">
              {reclaimResult.nothingToReclaim ? (
                <p>Nothing to reclaim — {reclaimResult.reportPeriod}&apos;s forward gap hasn&apos;t started yet.</p>
              ) : (
                <>
                  <p>
                    Reclaimed {reclaimResult.fromDate} to {reclaimResult.toDate} for{" "}
                    {reclaimResult.reportPeriod}: {reclaimResult.backfill?.canonicalRowsInserted ?? 0} canonical
                    rows, {reclaimResult.dailyDataQualityDatesProcessed} days of Daily Data recomputed.
                  </p>
                  {reclaimResult.instrumentSync && (
                    <p className="text-muted-foreground">
                      Instrument sync: {reclaimResult.instrumentSync.upserted} ISINs mapped.
                    </p>
                  )}
                </>
              )}
              {reclaimResult.warnings.length > 0 && (
                <details className="text-amber-600 dark:text-amber-400">
                  <summary>{reclaimResult.warnings.length} warning(s)</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {reclaimResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-mute threshold</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A stock that goes this many consecutive trading days without a live price stops showing
            the Overview banner&apos;s warning automatically. Default 5.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              value={muteThresholdInput}
              onChange={(e) => setMuteThresholdInput(e.target.value)}
              className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
            />
            <span className="text-sm text-muted-foreground">trading days</span>
            <Button onClick={handleSaveMuteThreshold} disabled={savingMuteThreshold}>
              {savingMuteThreshold ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock split/bonus detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The daily cron detects splits/bonuses automatically going forward (today vs. yesterday&apos;s
            close). Use this to retroactively detect one that already happened, or re-check a specific
            date the cron may have missed.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={detectDateInput}
              onChange={(e) => setDetectDateInput(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm"
            />
            <Button onClick={handleDetectShareAdjustments} disabled={detecting}>
              {detecting ? "Detecting..." : `Detect for ${detectDateInput || "today"}`}
            </Button>
          </div>
          {shareAdjustments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active split/bonus adjustments.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {shareAdjustments.map((adj) => (
                <li key={adj.isin} className="rounded-md border px-3 py-2">
                  <div>
                    <span className="font-medium">{adj.companyName}</span>{" "}
                    <span className="text-muted-foreground">
                      {formatSplitRatio(adj.effectiveMultiplier)} — detected {adj.firstDetectedOn}:{" "}
                      {adj.lastPriceBeforeInr.toFixed(2)} → {adj.lastPriceAfterInr.toFixed(2)}
                    </span>
                  </div>
                  {dismissingIsin === adj.isin ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <input
                        type="text"
                        value={dismissReason}
                        onChange={(e) => setDismissReason(e.target.value)}
                        placeholder="Why this isn't a real split"
                        className="rounded border bg-background px-1.5 py-0.5 text-xs"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleDismissShareAdjustment(adj.isin, adj.reportPeriod)}
                        disabled={isDismissingAdjustment || !dismissReason.trim()}
                      >
                        {isDismissingAdjustment ? "Saving..." : "Confirm"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => {
                          setDismissingIsin(null);
                          setDismissReason("");
                        }}
                        className="text-xs underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDismissingIsin(adj.isin);
                        setDismissReason("");
                      }}
                      className="mt-1 text-xs underline"
                    >
                      Not a real split — reverse
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
