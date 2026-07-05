// Shared "how many rows to show" control, lifted to a common ancestor
// (AmcGrid) and passed down as a prop so the same selection applies across
// the Overview, AUM Growth, and Cash Holdings tabs at once.
export type TopNOption = 10 | 15 | 20 | "all";
export const TOP_N_OPTIONS: TopNOption[] = [10, 15, 20, "all"];
export const DEFAULT_TOP_N: TopNOption = 20;
