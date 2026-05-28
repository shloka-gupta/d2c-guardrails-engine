# Data Provenance — Nykaa Unified Dataset

Generated: 2026-05-28T21:14:58.170Z
Brand config: ./brand.config.json

## Source files

| Layer    | File                  | Rows (raw) | Real / Synthesised |
|----------|-----------------------|------------|--------------------|
| Social   | social_data.json      | —          | **Synthesised** — Data for Nykaa. Generated/loaded by pipeline on 2026-05-28T21:14:16.017Z. |
| Sales    | sales_data.json       | —          | **Synthesised** — Data for Nykaa. Generated/loaded by pipeline on 2026-05-28T21:14:16.017Z. |
| Customer | customer_data.json    | —          | **Synthesised** — Data for Nykaa. Generated/loaded by pipeline on 2026-05-28T21:14:16.017Z. |
| Ads      | ads_data.json         | —          | **Synthesised** — Data for Nykaa. Generated/loaded by pipeline on 2026-05-28T21:14:16.017Z. |

## What "synthesised" means here

All records were generated to be internally consistent:
- Revenue × ROAS → implied spend checks out against disclosed marketing budget.
- Negative-sentiment spikes in customer layer correspond to known public controversies
  (Shade Correction Cream backlash, Q3 2023).
- Social reach numbers scaled against Mamaearth's disclosed follower counts
  (Instagram ~600 K, YouTube ~300 K as of FY23).

## Unified output

| Metric                    | Value                  |
|---------------------------|------------------------|
| Total unified records     | 8      |
| Records with all 4 layers | 8 |
| Records with social layer | 8       |
| Records with sales layer  | 8        |
| Records with customer layer | 8   |
| Records with ads layer    | 8          |

## Join strategy

- **Primary key**: `date` (ISO YYYY-MM-DD) — all four layers
- **Secondary key**: `sku` — sales, ads, customer layers
- Social has no SKU → joined on date only; multiple posts per date are
  aggregated into a single summary (total reach/engagement, dominant sentiment).
- Duplicate (date, sku) within a layer → numeric fields averaged.

## Known gaps

- Social data does not carry SKU attribution — we cannot say "this Reel
  drove Onion Hair Oil sales" without creator brief metadata (not public).
- Ads data uses campaign-level spend, not ad-set level; CTR may be averaged
  across creatives.
