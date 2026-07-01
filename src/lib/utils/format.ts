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

export function formatDeltaCr(valueCr: number): string {
  const sign = valueCr > 0 ? "+" : "";
  return `${sign}${formatCr(valueCr)}`;
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
