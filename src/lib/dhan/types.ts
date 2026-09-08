export type ExchangeSegment = "NSE_EQ" | "BSE_EQ" | "IDX_I" | "MCX_COMM";

// DHAN's historical/charts API's own instrument-type discriminator --
// "INDEX" for IDX_I-segment instruments (e.g. NIFTY 50/500), "EQUITY" for
// everything else this app tracks, "FUTCOM" for MCX commodity futures
// (Gold/Silver) -- confirmed against DHAN's own public instrument master
// (api-scrip-master.csv), which lists MCX gold/silver contracts under
// SEM_INSTRUMENT_NAME "FUTCOM".
export type DhanInstrumentType = "EQUITY" | "INDEX" | "FUTCOM";

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
