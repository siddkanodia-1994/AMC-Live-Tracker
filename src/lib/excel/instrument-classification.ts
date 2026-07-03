// Certificates of deposit / commercial paper / bonds are commonly filed under
// an issuer's normal sector (e.g. "Bank"), indistinguishable from that
// issuer's equity shares by sector alone — but their display name carries a
// maturity date in parentheses (e.g. "ICICI Bank Ltd. (27-Jan-2027)"), the
// same convention used for G-Sec/T-Bill rows.
const FIXED_MATURITY_DATE_SUFFIX = /\(\s*\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{2,4}\s*\)\s*$/;

export function looksLikeFixedMaturityDebtInstrument(companyName: string): boolean {
  return FIXED_MATURITY_DATE_SUFFIX.test(companyName);
}

// A holding is a debt instrument if it's tagged G-Sec (government security /
// T-Bill) or its name carries a fixed-maturity-date suffix (bank CDs/CPs/NCDs
// filed under a non-"G-Sec" sector like "Bank"). Shared by the parser (to
// exclude these from isPriceable) and the live-AUM display (to report a
// separate debt-instrument count).
export function isDebtInstrument(sector: string, companyName: string): boolean {
  return sector === "G-Sec" || looksLikeFixedMaturityDebtInstrument(companyName);
}

// Repo/money-market line items that show up as untagged rows (isin null,
// sector "Miscellaneous"/"Finance"/"Others") rather than under the G-Sec or
// fixed-maturity-date conventions above — confirmed exact names seen across
// AMC sheets. Matched case-insensitively since capitalization isn't consistent
// across sheets (e.g. "Tri-Party Repo (TREPS)" vs any casing variant of it).
const REPO_MONEY_MARKET_NAMES = new Set([
  "tri-party repo (treps)",
  "repo instruments",
  "clearing corporation of india ltd.",
  "call money",
  "cblo",
]);

// "Bank Debt & Repo" card: the existing debt classification (G-Secs, dated
// CDs/CPs) plus the repo/money-market instruments above, which aren't caught
// by isDebtInstrument since they carry neither a G-Sec sector tag nor a
// fixed-maturity-date suffix.
export function isBankDebtOrRepo(sector: string, companyName: string): boolean {
  return isDebtInstrument(sector, companyName) || REPO_MONEY_MARKET_NAMES.has(companyName.trim().toLowerCase());
}

// Cash/net-current-assets line items — same untagged-row pattern as repo
// above, but the different naming variants sheets use for "what's left over
// in cash," confirmed across AMC sheets.
const CASH_EQUIVALENT_NAMES = new Set(["net current asset", "cash & cash equivalent", "other assets"]);

export function isCashEquivalent(companyName: string): boolean {
  return CASH_EQUIVALENT_NAMES.has(companyName.trim().toLowerCase());
}

// Standard ISIN shape: 2-letter country code + 9 alphanumeric + 1 check digit.
export const ISIN_FORMAT = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// US-listed equities (ISIN country prefix "US") are priced via Finnhub +
// USD/INR conversion — scoped to US specifically (not "any foreign holding")
// since that's what's been validated end-to-end; other countries (Taiwan,
// Japan, etc.) remain on last-reported value for now.
export function isUsListedEquityIsin(isin: string): boolean {
  return ISIN_FORMAT.test(isin) && isin.startsWith("US");
}
