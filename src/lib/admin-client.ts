"use client";

const STORAGE_KEY = "admin-secret";

export function getStoredAdminSecret(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function storeAdminSecret(secret: string): void {
  sessionStorage.setItem(STORAGE_KEY, secret);
}

export function clearStoredAdminSecret(): void {
  sessionStorage.removeItem(STORAGE_KEY);
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
