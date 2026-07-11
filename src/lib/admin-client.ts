"use client";

const STORAGE_KEY = "admin-secret";

// localStorage, not sessionStorage -- the original version of this gate
// (removed 2 Jul, commit 945783d) used sessionStorage, which meant
// re-entering the secret every fresh browser session. That friction was
// the whole reason it got removed. localStorage persists across restarts
// until an explicit "Log out" or the browser's site data is cleared, which
// keeps the daily DHAN-token-refresh workflow just as frictionless as when
// there was no gate at all, while still blocking anyone without the secret.
export function getStoredAdminSecret(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function storeAdminSecret(secret: string): void {
  localStorage.setItem(STORAGE_KEY, secret);
}

export function clearStoredAdminSecret(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function adminFetch(url: string, secret: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      "x-admin-secret": secret,
    },
  });
}
