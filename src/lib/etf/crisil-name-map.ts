import crisilNameMapJson from "../../../data/etf-crisil-name-map.json";

interface CrisilNameMapping {
  crisilName: string;
  schemeSlug: string;
}

interface CrisilNameMapFile {
  mappings: CrisilNameMapping[];
  excludedNames: string[];
}

const MAP = crisilNameMapJson as unknown as CrisilNameMapFile;
const MAPPING_BY_NAME = new Map(MAP.mappings.map((m) => [m.crisilName, m.schemeSlug]));
const EXCLUDED = new Set(MAP.excludedNames);

export type CrisilNameClassification =
  | { type: "mapped"; schemeSlug: string }
  | { type: "excluded" } // a known, deliberately-ignored name (e.g. a Gold/Silver Fund-of-Funds wrapper)
  | { type: "unknown" }; // never seen before -- caller should hard-fail

/**
 * Classifies a Gold/Silver scheme name exactly as it appears in the user's
 * CRISIL "Index Funds" archive. Every name this app's ingestion script
 * (scripts/ingest-etf-crisil-exit-aum.ts) encounters must resolve to either
 * "mapped" or "excluded" -- an "unknown" result means data/etf-crisil-name-
 * map.json needs updating, same hard-fail-rather-than-silently-drop
 * convention as data/amc-name-map.json for the main Mirae import.
 */
export function classifyCrisilName(crisilName: string): CrisilNameClassification {
  if (EXCLUDED.has(crisilName)) return { type: "excluded" };
  const schemeSlug = MAPPING_BY_NAME.get(crisilName);
  if (schemeSlug) return { type: "mapped", schemeSlug };
  return { type: "unknown" };
}
