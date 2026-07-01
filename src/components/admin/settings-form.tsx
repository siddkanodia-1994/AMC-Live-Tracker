"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminFetch } from "@/lib/admin-client";
import { formatRelativeTime } from "@/lib/utils/format";

interface TokenStatus {
  configured: boolean;
  updatedAt: string | null;
}

export function SettingsForm({ secret }: { secret: string }) {
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFetch("/api/admin/settings", secret)
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => toast.error("Failed to load DHAN token status"));
  }, [secret]);

  async function handleSave() {
    if (!token.trim()) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/settings", secret, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dhanAccessToken: token.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save token");
      }
      setStatus(await res.json());
      setToken("");
      toast.success("DHAN access token updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save token");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>DHAN access token</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {status
            ? status.configured
              ? `Configured — last updated ${formatRelativeTime(status.updatedAt!)}. DHAN tokens expire every ~24h.`
              : "No token configured yet. Live pricing will fall back to reported values until one is added."
            : "Loading status..."}
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Paste a freshly generated DHAN access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button onClick={handleSave} disabled={saving || !token.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
