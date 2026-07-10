"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils/format";

interface SettingsStatus {
  dhanToken: { configured: boolean; updatedAt: string | null };
  dhanClientId: { configured: boolean; value: string | null; updatedAt: string | null; source: "db" | "env" | "none" };
}

// Only the last 4 characters are ever shown on screen (shoulder-surfing /
// screen-share safety) -- both for the saved value at rest and while typing
// a replacement. Number of `*` matches the real hidden length.
function maskExceptLast4(value: string): string {
  return value.length <= 4 ? value : "*".repeat(value.length - 4) + value.slice(-4);
}

export function SettingsForm() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [hasStartedEditingClientId, setHasStartedEditingClientId] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingPartialEdit, setConfirmingPartialEdit] = useState(false);
  const clientIdInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data: SettingsStatus) => {
        setStatus(data);
        setClientId(data.dhanClientId.value ?? "");
        setHasStartedEditingClientId(false);
      })
      .catch(() => toast.error("Failed to load DHAN settings status"));
  }, []);

  // The input's displayed value is always masked, so `e.target.value` can't
  // be trusted directly -- it would include literal `*` characters. Instead
  // read what was actually typed/deleted/pasted from the native InputEvent,
  // independent of the mask on screen. First edit against the untouched
  // saved value starts a fresh replacement rather than splicing into the
  // real saved digits. Only supports append/delete at the end (no mid-string
  // cursor edits into the masked portion) -- the same assumption any
  // OTP/PIN-style masked input makes, and the realistic way a client ID gets
  // retyped or pasted anyway.
  function handleClientIdInput(e: React.ChangeEvent<HTMLInputElement>) {
    const native = e.nativeEvent as InputEvent;
    setClientId((prev) => {
      const base = hasStartedEditingClientId ? prev : "";
      if (native.inputType?.startsWith("insert")) return base + (native.data ?? "");
      if (native.inputType?.startsWith("delete")) return base.slice(0, -1);
      return base;
    });
    setHasStartedEditingClientId(true);
    setConfirmingPartialEdit(false);
  }

  // The rendered value is a masked string, so the browser's own
  // cursor-restoration heuristics have nothing reliable to anchor to after
  // each keystroke -- pin the cursor to the end, matching the append/delete-
  // at-end-only editing model above.
  useEffect(() => {
    const input = clientIdInputRef.current;
    if (input && document.activeElement === input) {
      const end = maskExceptLast4(clientId).length;
      input.setSelectionRange(end, end);
    }
  }, [clientId]);

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
            ref={clientIdInputRef}
            type="text"
            placeholder="DHAN client ID"
            value={maskExceptLast4(clientId)}
            onChange={handleClientIdInput}
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
