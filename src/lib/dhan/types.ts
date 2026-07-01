export type ExchangeSegment = "NSE_EQ" | "BSE_EQ";

export interface LtpRequestItem {
  securityId: string;
  exchangeSegment: ExchangeSegment;
}

// Keyed by "SEGMENT:securityId" — security IDs are not guaranteed unique across
// exchange segments, so a composite key avoids collisions between NSE_EQ/BSE_EQ.
export interface LtpResult {
  pricesBySecurityId: Map<string, number>;
  failedSecurityIds: Set<string>;
  apiError?: string;
}

export interface RawInstrumentRow {
  isin: string;
  securityId: string;
  exchangeSegment: ExchangeSegment;
  tradingSymbol: string | null;
}
