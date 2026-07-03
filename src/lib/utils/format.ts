export function formatCr(valueCr: number): string {
  return `₹${valueCr.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} cr`;
}

export function formatPct(value: number, opts?: { alwaysSign?: boolean }): string {
  const pct = value * 100;
  const sign = opts?.alwaysSign && pct > 0 ? "+" : "";
  return `${sign}${pct.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}%`;
}

export function formatPriceInr(priceInr: number): string {
  return `₹${priceInr.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function formatShares(shares: number): string {
  return shares.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function formatDeltaCr(valueCr: number): string {
  const sign = valueCr > 0 ? "+" : "";
  return `${sign}${formatCr(valueCr)}`;
}

export function formatShortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatRelativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
