# Data Provenance — Mamaearth Engine

## What this file is
Documents every data source used in this project.
Real = pulled from an actual API or public source.
Synthesized = realistically made up, grounded in public information.

## Layer 1: Social (social.json)
- Status: Synthesized
- Grounded in: Mamaearth's public Instagram/YouTube presence (~1.5M followers)
- Dates and engagement numbers reflect realistic Q3 2023 patterns
- Sentiment reflects real public controversies (shade range complaints, July 2023)

## Layer 2: Sales (sales.json)
- Status: Synthesized
- Grounded in: Mamaearth Q3 2023 earnings report (revenue ~₹500Cr)
- SKUs reflect actual Mamaearth product lines
- Refund spikes tied to real complaint patterns

## Layer 3: Customers (customers.json)
- Status: Synthesized
- Grounded in: Publicly observable Amazon India reviews tone
- NPS and ticket volumes reflect realistic D2C brand benchmarks
- Shade Correction Cream complaint spike reflects real public sentiment

## Layer 4: Ads (ads.json)
- Status: Synthesized
- Grounded in: Industry standard ROAS benchmarks for D2C skincare in India
- Spend levels consistent with a brand of Mamaearth's scale

## What we would replace with real data
- Social: YouTube Data API (free, can pull real video stats)
- Customers: Amazon reviews via scraping
- Sales + Ads: Would require Mamaearth internal access