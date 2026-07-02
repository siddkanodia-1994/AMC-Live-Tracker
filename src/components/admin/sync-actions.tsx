"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export function SyncActions() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/sync-instruments", { method: "POST" });
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
      const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
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

  return (
    <div className="grid gap-4 sm:grid-cols-2">
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
    </div>
  );
}
