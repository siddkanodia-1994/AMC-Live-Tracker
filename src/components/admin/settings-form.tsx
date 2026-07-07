"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils/format";

interface SettingsStatus {
  dhanToken: { configured: boolean; updatedAt: string | null };
  dhanClientId: { configured: boolean; value: string | null; updatedAt: string | null; source: "db" | "env" | "none" };
}

export function SettingsForm() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingPartialEdit, setConfirmingPartialEdit] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data: SettingsStatus) => {
        setStatus(data);
        setClientId(data.dhanClientId.value ?? "");
      })
      .catch(() => toast.error("Failed to load DHAN settings status"));
  }, []);

  const clientIdChanged = clientId.trim() !== (status?.dhanClientId.value ?? "");
  const isPartialEdit = clientIdChanged && !token.trim();

  async function handleSave(force = false) {
    if (!clientId.trim()) return;
    if (isPartialEdit && !force) {
      setConfirmingPartialEdit(true);
      return;
    }
    setConfirmingPartialEdit(false);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dhanClientId: clientId.trim(),
          ...(token.trim() ? { dhanAccessToken: token.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to save DHAN settings");
      }
      setStatus(body);
      setClientId(body.dhanClientId.value ?? "");
      setToken("");
      if (body.warning) {
        toast.warning(body.warning);
      } else {
        toast.success("DHAN credentials updated");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save DHAN settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>DHAN credentials</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {status
            ? status.dhanToken.configured
              ? `Token configured — last updated ${formatRelativeTime(status.dhanToken.updatedAt!)}. DHAN tokens expire every ~24h.`
              : "No token configured yet. Live pricing will fall back to reported values until one is added."
            : "Loading status..."}
        </p>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Client ID</label>
          <Input
            type="text"
            placeholder="DHAN client ID"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setConfirmingPartialEdit(false);
            }}
          />
          {status?.dhanClientId.source === "env" && (
            <p className="text-xs text-muted-foreground">Using DHAN_CLIENT_ID from environment (not yet saved here).</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Access token</label>
          <Input
            type="password"
            placeholder="Paste a freshly generated DHAN access token (leave blank to keep the current one)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        {confirmingPartialEdit && (
          <p className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            You changed the Client ID without a new token — the existing token was generated for a different account
            and will likely be rejected. Paste a token generated under the new Client ID, or Save anyway.
          </p>
        )}
        <div className="flex gap-2">
          <Button onClick={() => handleSave(confirmingPartialEdit)} disabled={saving || !clientId.trim()}>
            {saving ? "Saving..." : confirmingPartialEdit ? "Save anyway" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
