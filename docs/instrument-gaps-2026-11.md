# Instrument-map gaps — November 2026

**As of:** 2026-11-03 · **Current report period:** 2026-09 · **Scope:** every priceable 2026-09 holding with no `instrument_map` row (30 ISINs), plus the 2 ISINs stuck in `stale_mapping_unresolved_log` since 2026-09-18.

**What "unmapped" means for live AUM:** `computeLiveAum` prices a priceable holding through `instrument_map`. With no mapping, and no earlier `isin_daily_price` row (none of the 30 has one), the holding is `stale_fallback`: it stays at its reported value. The **reported value is therefore the amount of AUM that doesn't move with the market**, not money that's missing.

## Sources

- **DB:** read-only `ops:agent sql` (READ ONLY transaction, aggregate queries only). Values are `sum(holdings.market_value_cr)` across AMCs for 2026-09, with 2026-08 shown for comparison.
- **DHAN master:** `https://images.dhan.co/api-data/api-scrip-master-detailed.csv`, downloaded 2026-11-03 into a scratch directory outside the repo and only grepped (35.4 MB, 208,025 rows). Each ISIN was checked three ways:
  1. exact ISIN: `grep ",<ISIN>,"`
  2. same issuer: ISIN characters 4–7, e.g. `grep -E ",IN[E9]0Y9J[0-9A-Z]*,"`. This catches successor securities: a new equity series, the fully-paid line behind a partly-paid one, or the equity behind a preference share.
  3. company name fragment. Debt (`DEB`) rows are ignored.
- **The new probe check:** `instrument-map-gaps` returns the same totals, 30 ISINs and ₹683.31 cr (see the end of this report).

**None of the 32 ISINs exists in DHAN's master.** No row can be fixed by re-running "Sync Instruments" today, and no row has a successor that it would be correct to map to (reasoning per row below).

## Classification (sorted by 2026-09 reported value)

| # | ISIN | Name | AMCs | 2026-09 ₹ cr | 2026-08 ₹ cr | Reason | Recommended action |
|---|---|---|---|---:|---:|---|---|
| 1 | INE0Y9J01020 | HEG Graphite Ltd. | HDFC, SBI, Bandhan, Mahindra Manulife, Bajaj Finserv, Bank of India, Unifi (7) | **616.4770** | 0.0000 | Not yet listed (demerger) | Leave at reported value until it lists, then run **Sync Instruments** |
| 2 | INE105A04039 | TVS Holdings Ltd. – (Pref Shares) | ICICI Pru, SBI, Nippon, ABSL, Franklin, Bandhan, Sundaram (7) | **66.6084** | 0.0000 | Preference shares | Leave at reported value (≈ face value); Sync Instruments will pick it up if DHAN lists it |
| 3 | INE147E01013 | Crescent Finstock Ltd. | Sundaram | 0.0960 | 0.0908 | Suspended or delisted (no NSE/BSE scrip) | Leave at reported value, permanently |
| 4 | INE076B04022 | Siyaram Silk Mills Ltd. – (Preference Shares) | PPFAS | 0.0730 | 0.0730 | Preference shares | Leave at reported value, permanently |
| 5 | INE076B04014 | Siyaram Silk Mills Ltd. – (Preference Share) | PPFAS | 0.0547 | 0.0547 | Preference shares | Leave at reported value, permanently |
| 6 | INE494B04019 | TVS Motors Ltd. – (Preference Shares) — **stuck mapping** | 19 AMCs, all at 0 shares | 0.0000 | 72.4882 | Preference shares (redeemed) | **Mute** (needs your decision, see below) |
| 7 | IN9572J01019 | Spandana Sphoorty – (Partly Paid-up, Rights) — **stuck mapping** | JM Financial, at 0 shares | 0.0000 | 3.2666 | ISIN changed (partly paid → fully paid); successor exists and is already mapped | **Mute** (needs your decision, see below) |
| 8 | INE05CZ20011 | Ratnaveer Precision Engg. – (Rights Entitlements) | Taurus, at 0 shares | 0.0000 | 0.0503 | Rights entitlement (lapsed or converted; position exited) | Leave at reported value (₹0). **Don't** map it to the equity |
| 9–32 | 24 legacy ISINs (table below) | Long-delisted / written-off names | various | 0.0000 each | 0.0000 each | Suspended or delisted | Leave at reported value (₹0), permanently |

**Totals:** the 30 unmapped ISINs hold **₹683.31 cr** at reported value. Rows 1 and 2 account for ₹683.09 cr of that (**99.97%**). The two stuck mappings hold ₹0 in 2026-09.

## Evidence, row by row

### 1. HEG Graphite Ltd. — INE0Y9J01020 — ₹616.48 cr

- **DHAN master:** no row for the ISIN, for issuer code `0Y9J`, or for any name containing "HEG Graphite".
- **The parent is in the master under a new name, same ISIN:** `NSE,E,1336,INE545A01024,EQUITY,,HEGAM,HEG ADVANCED MATERIAL LTD` and `BSE,E,509631,INE545A01024,…,HEGAM,HEG Advanced Materials Li`. There is no longer a plain "HEG" symbol. INE545A01024 is mapped to `1336 / NSE_EQ` and priced live.
- **DB, a demerger signature:**
  - The parent fell from ₹959.76 cr (13,169,043 shares, ₹728.80/sh) in 2026-08 to ₹329.88 cr (13,880,935 sh, ₹237.65/sh) in 2026-09.
  - HEG Graphite appeared at 13,165,551 shares, ₹468.25/sh, with no 2026-08 holding. That is a 1:1 entitlement: 99.97% of the parent's August share count.
  - Parent plus Graphite per share in September is ₹705.90, close to the parent's ₹728.80 in August.
  - The issuer code `0Y9J` is a freshly allotted one.
- **Why no successor mapping:** there's nothing to map to. The parent is a different company now (HEG Advanced Materials) and is already priced. Mapping Graphite to the parent's security ID would double-count the parent's price.
- **Action:** leave at reported value. When HEG Graphite lists and appears in DHAN's master, press **Sync Instruments** in /admin. It maps every priceable ISIN that matches the master. This is the row that keeps the new probe check at `warn` until then.

### 2. TVS Holdings Ltd. – Pref Shares — INE105A04039 — ₹66.61 cr

- **DHAN master:** the issuer `105A` has only the equity line, `NSE,E,29011,INE105A01035,…,TVSHLTD` (BSE 520056), and three NCDs (`INE105A08…`, `DEB`). It has no `INE105A04…` (security type 04 = preference) rows.
- **DB:** new in 2026-09 (no 2026-08 holding), 66,552,432 shares, ₹10.01/sh. That is face value: the AMCs are carrying it at par. The equity (INE105A01035) is mapped to `29011 / NSE_EQ` and priced.
- **Why no successor mapping:** a preference share is a separate fixed-income-like instrument. Pricing it at the equity's ~₹12,107/share would overstate it by roughly 1,200×.
- **Precedent:** TVS Motor's own bonus preference shares (row 6) *were* listed on NSE (security 761141) while they were outstanding. If DHAN lists these too, Sync Instruments will map them with no code change.
- **Action:** leave at reported value. Drift is small because the shares sit at face value.

### 3. Crescent Finstock Ltd. — INE147E01013 — ₹0.096 cr

- **DHAN master:** no ISIN, issuer `147E`, or name match. The only "CRESCENT" row is `INE754C01010 Crescentis Capital`, a different issuer and **not** a successor.
- **DB:** 39,500 shares, unchanged. The AMC's own mark moved from ₹22.99 to ₹24.30/sh, so Sundaram is fair-valuing a security with no NSE/BSE scrip.
- **Action:** leave at reported value, permanently. The amount is immaterial.

### 4–5. Siyaram Silk Mills preference shares — INE076B04022, INE076B04014 — ₹0.13 cr combined

- **DHAN master:** issuer `076B` has only the equity, `NSE,E,14096,INE076B01028,…,SIYSIL` (BSE 503811). There are no `INE076B04…` rows.
- **DB:** 72,996 and 54,747 shares, ₹10.00 and ₹9.99/sh (face value), unchanged from August.
- **Action:** leave at reported value, permanently. Mapping them to the equity would be wrong, for the same reason as row 2.

### 6. TVS Motor preference shares — INE494B04019 — stuck mapping, ₹0

- **`stale_mapping_unresolved_log`:**
  - mapped security: `761141 / NSE_EQ`, "TVS MOTOR COMPANY LIMITED"
  - first checked 2026-09-18, last checked 2026-11-02, so the daily cron re-checks it every day
- **DHAN master:** security IDs 761141 and 758420 both return 0 rows, and issuer `494B` has no `04` series left. Only the equity is listed, `NSE,E,8479,INE494B01023,…,TVSMOTOR` (mapped, priced), plus two NCDs.
- **DB:**
  - held by 21 AMCs at ~69–71M shares from 2026-06 to 2026-08 (₹72.49 cr in 2026-08)
  - 2026-09: 19 AMCs still list it, **all at 0 shares**
  - So the preference shares were redeemed or exited, and the ISIN is gone from the exchange.
- **Why it's still flagged:** the 0-share rows remain in `holdings` for 2026-09, so live AUM keeps resolving the ISIN as `last_close` from its old `isin_daily_price` rows (82 of them). After the auto-mute threshold that makes it a daily `reclaimStaleInstrumentMappings` candidate. The master has no row, so it's re-upserted into the unresolved log every day. The AUM effect is ₹0, because price × 0 shares = 0.
- **Recommended:** **mute** it via the Overview banner's "Accept" with a reason such as "redeemed preference shares, 0 shares held". A manual mute removes it from the reclaim candidates (`muteReason === null` filter in the daily-snapshot cron). Because it stays flagged, `clearRecoveredManualMutes` won't clear it. No successor mapping applies: the economic successor is cash.

### 7. Spandana Sphoorty partly-paid rights shares — IN9572J01019 — stuck mapping, ₹0

- **`stale_mapping_unresolved_log`:**
  - mapped security: `758420 / NSE_EQ`, "SPANDANA RS.5 PPD UP"
  - first checked 2026-09-18, last checked 2026-11-02
- **DHAN master:** no row for the ISIN or for security 758420. Partly-paid lines in general *are* present in the master (e.g. `IN90PTR01010 … RS.5 PPD UP`), so this one's absence means it stopped trading.
- **DB, the ISIN change is proven:**
  - JM Financial held 259,353 partly-paid shares in 2026-08 and 0 in 2026-09.
  - Over the same month, JM's fully-paid INE572J01011 rose from 315,857 to 575,210 shares, **+259,353 exactly**.
  - So the final call was paid and the shares converted into the ordinary line.
  - The successor INE572J01011 is already mapped (`NSE,E,11435,INE572J01011,…,SPANDANA` → `11435 / NSE_EQ`) and priced live.
- **Recommended:** **mute**, the same mechanics as row 6. Don't re-point the partly-paid ISIN at 11435. The successor holding is already priced under its own ISIN, so the shares would be counted twice.

### 8. Ratnaveer Precision Engineering rights entitlements — INE05CZ20011 — ₹0

- **DHAN master:** no row for the RE ISIN. RE lines in general do appear while they trade (e.g. `INE637H20024 … SHIVAM-RE1`). The equity is listed: `NSE,E,18423,INE05CZ01011,…,RATNAVEER`, and it's mapped.
- **DB:**
  - Taurus held 11,997 REs in 2026-08 (₹0.0503 cr) and 0 in 2026-09.
  - Taurus's equity holding in the same company also went to 0 in 2026-09.
  - So the position was exited. The REs lapsed or converted into equity that was then sold.
  - The RE ISIN has no `isin_daily_price` history, so it was never priced. Unlike rows 6–7, it isn't generating stale-mapping noise.
- **Action:** leave at reported value (₹0). Mapping it to the equity would misprice any future RE holding.

### 9–32. Long-delisted or written-off holdings — ₹0 each

For each of these 24 ISINs, all of the following hold:
- no exact-ISIN, issuer-code, or name match in DHAN's master
- reported value ₹0.0000 in both 2026-08 and 2026-09
- the same share count in both months

AMCs keep these lines at zero as written-off legacy positions. They have no AUM effect, because live AUM uses the reported ₹0.

| ISIN | Name | AMCs | Shares (2026-09) | ₹ cr |
|---|---|---|---:|---:|
| INE313A01019 | BS Refrigerators Ltd. | UTI | 387,231 | 0.0000 |
| INE286A01017 | DSQ Software Ltd. | Baroda BNP | 10,500 | 0.0000 |
| INE030B01017 | Elbee Services Ltd. | UTI | 70,000 | 0.0000 |
| INE671B01018 | Globsyn Technologies Limited | Franklin, Nippon | 23,000 | 0.0000 |
| INE884G01032 | GPI Textiles Ltd | UTI | 58,452 | 0.0000 |
| INE551A01022 | Hindustan Dorr-Oliver Ltd. | Sundaram | 935,386 | 0.0000 |
| INE549I01011 | Innoventive Industries Ltd. | Nippon | 3,000,000 | 0.0000 |
| INE408E01027 | Maestros Mediline Systems Ltd. | ABSL | 50,000 | 0.0000 |
| INE122R01018 | Manpasand Beverages Ltd. | SBI | 6,057,282 | 0.0000 |
| INE891H01019 | Maruti Cottex Ltd. | ABSL | 249,800 | 0.0000 |
| INE317N01013 | MMS Infrastructure Ltd. | ABSL | 80,970 | 0.0000 |
| INE864A01011 | MTZ Polyfilms Ltd. | UTI | 6,325,000 | 0.0000 |
| INE348C01011 | Mukerian Papers Ltd. | Sundaram, UTI | 495,850 | 0.0000 |
| INE703F01010 | Numero Uno International Ltd. | SBI | 580,000 | 0.0000 |
| INE114B01019 | Padmini Technologies Ltd. | SBI | 250 | 0.0000 |
| INE604A01011 | Precision Fastners Ltd. | Sundaram | 200 | 0.0000 |
| INE431E01011 | Sangam Health Care Products Ltd. | Sundaram | 200,000 | 0.0000 |
| INE468B01019 | SIP Technologies & Exports Ltd | DSP, SBI | 157,563 | 0.0000 |
| INE639A01017 | SIV Industries Ltd. | Baroda BNP | 14,750 | 0.0000 |
| INE645A01014 | Spartek Ceramics India Ltd. | UTI | 6,154 | 0.0000 |
| INE981A01013 | Transtream India.com Ltd. | Baroda BNP | 1,000 | 0.0000 |
| INE696A01025 | United Breweries (Holdings) Ltd. | ABSL | 1,668,671 | 0.0000 |
| INE307001011 | Visakha Aqua Farms | ABSL | 129,900 | 0.0000 |
| INE752A01018 | Wellwin Industry Ltd. | Taurus | 189,983 | 0.0000 |

**Name near-misses in the master that are *not* successors.** Each is a different issuer code, so none should ever be mapped to these rows:
- `INE686F01025 United Breweries Ltd` (UBL) vs United Breweries **(Holdings)** INE696A01025
- `INE318N01011 Maestros Electronics & Telecom` vs Maestros **Mediline** INE408E01027
- `INE495C01010 Sangam (India)` and `INE475D01010 Sangam Finserv` vs **Sangam Health Care** INE431E01011

## Summary

- **Total value affected:**
  - **₹683.31 cr** of 2026-09 reported holdings sit unmapped at reported value: 30 ISINs, about 0.018% of the ₹37.56 lakh cr total reported AUM.
  - **₹616.48 cr (90%) is HEG Graphite alone**, plus ₹66.61 cr of TVS Holdings preference shares.
  - The other 28 ISINs total ₹0.22 cr.
  - The two stuck mappings hold ₹0 in 2026-09.
- **No mapping fix is available today.** None of the 32 ISINs is in DHAN's master, and no row has a successor it would be correct to map to.
- **Rows needing your decision:**
  1. **TVS Motor pref (INE494B04019) and Spandana partly-paid (IN9572J01019): mute or wait?**
     - **Mute now:** use the Overview banner's "Accept" with a reason. This stops the daily reclaim re-check and banner noise.
     - **Wait for the 2026-10 import:** the 0-share rows may drop out then. That isn't guaranteed: 111 zero/zero rows persist in 2026-09.
     - Either way, the existing `unresolved-stale-mappings` probe check reads `stale_mapping_unresolved_log` without the 30-day window the UI uses (`getUnresolvedStaleMappings`). It stays `warn` until either the two log rows are deleted (a DB delete, needs your approval) or that check is changed to the same window.
  2. **HEG Graphite (INE0Y9J01020): when it lists, press Sync Instruments in /admin.** This is a manual step: `syncInstrumentMap` runs only from /admin and from `reclaim-forward-gap`. Until then, `instrument-map-gaps` will report `warn` (over both the ₹500 cr total and ₹200 cr single-ISIN limits).
- **Everything else:** leave at reported value. No action is needed.

## New probe check

`instrument-map-gaps` in `src/lib/ops/probe.ts`:
- Counts priceable current-period holdings with no `instrument_map` row, and their reported value. One grouped and ranked aggregate query returns the count, total and top 3.
- `ok` when the total is ≤ ₹500 cr and no single ISIN is over ₹200 cr; otherwise `warn`.

Output on 2026-11-03 (`ops:probe --dry-run`):

```
warn    instrument-map-gaps        30 priceable ISIN(s) unmapped, ₹683 cr held at reported value (total > ₹500 cr, one ISIN > ₹200 cr); top: HEG Graphite Ltd. ₹616 cr; TVS Holdings Ltd. - (Pref Shares) ₹67 cr; Crescent Finstock Ltd. ₹0.10 cr
```
