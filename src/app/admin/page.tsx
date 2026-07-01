"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsForm } from "@/components/admin/settings-form";
import { SyncActions } from "@/components/admin/sync-actions";
import { adminFetch, clearStoredAdminSecret, getStoredAdminSecret, storeAdminSecret } from "@/lib/admin-client";

export default function AdminPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // sessionStorage isn't available during SSR, so this must run client-side
    // in an effect; the one extra render is negligible on this low-traffic page.
    const stored = getStoredAdminSecret();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setSecret(stored);
  }, []);

  async function handleUnlock() {
    setChecking(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/settings", inputValue);
      if (!res.ok) throw new Error("Incorrect admin secret");
      storeAdminSecret(inputValue);
      setSecret(inputValue);
    } catch {
      setError("Incorrect admin secret");
    } finally {
      setChecking(false);
    }
  }

  if (!secret) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="mb-4 text-xl font-semibold">Admin</h1>
        <div className="space-y-3">
          <Input
            type="password"
            placeholder="Admin secret"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleUnlock} disabled={checking || !inputValue} className="w-full">
            {checking ? "Checking..." : "Unlock"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearStoredAdminSecret();
            setSecret(null);
          }}
        >
          Lock
        </Button>
      </div>
      <SettingsForm secret={secret} />
      <SyncActions secret={secret} />
    </div>
  );
}
