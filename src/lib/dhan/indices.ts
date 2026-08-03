// Security IDs confirmed directly against DHAN's own public instrument
// master CSV (images.dhan.co/api-data/api-scrip-master-detailed.csv) --
// both are NSE, segment "I" (index) in that file, which corresponds to
// exchange segment "IDX_I" in the live LTP/marketfeed and historical/charts
// APIs (confirmed against DHAN's own API docs).
export const INDEX_KEYS = ["NIFTY_50", "NIFTY_500"] as const;
export type IndexKey = (typeof INDEX_KEYS)[number];

export const INDEX_SECURITY_IDS: Record<IndexKey, string> = {
  NIFTY_50: "13",
  NIFTY_500: "19",
};

export const INDEX_DISPLAY_NAMES: Record<IndexKey, string> = {
  NIFTY_50: "Nifty 50",
  NIFTY_500: "Nifty 500",
};
