// Only the last 4 characters of a sensitive value are ever shown -- both
// server-side (API responses) and client-side (the settings form's input at
// rest and mid-edit). Number of `*` matches the real hidden length.
export function maskExceptLast4(value: string): string {
  return value.length <= 4 ? value : "*".repeat(value.length - 4) + value.slice(-4);
}
