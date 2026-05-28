import json
import random
from datetime import datetime, timedelta

# ==============================================================================
# AUDITED PUBLIC METRICS CONFIGURATION (HONASA CONSUMER LTD / MAMAEARTH)
# ==============================================================================
START_DATE = datetime(2023, 1, 1)
END_DATE = datetime(2026, 5, 28) 

# 🚀 SCALE MULTIPLIER: Increase to 10 or 50+ for massive data lake simulation
SCALE_FACTOR = 5 

DAILY_TARGET_REVENUE_POOL = (2500000000 / 365) 

BRAND_PROFILES = {
    "Mamaearth": {
        "weight": 0.55,
        "growth_vector": 1.14,
        "skus": {
            "ME-ONION-OIL-200": {"name": "Onion Hair Oil 200ml", "price": 419, "cogs_pct": 0.28, "cat": "Haircare"},
            "ME-VITC-WASH-100": {"name": "Vitamin C Face Wash 100ml", "price": 259, "cogs_pct": 0.29, "cat": "Skincare"},
            "ME-ROSEMARY-SHM-250": {"name": "Rosemary Anti-Hairfall Shampoo", "price": 349, "cogs_pct": 0.30, "cat": "Haircare"},
            "ME-RICE-WASH-100": {"name": "Rice Water Glass Face Wash", "price": 269, "cogs_pct": 0.29, "cat": "Skincare"}
        }
    },
    "The Derma Co": {
        "weight": 0.25,
        "growth_vector": 1.42,
        "skus": {
            "DC-10-NIACIN-30": {"name": "10% Niacinamide Serum 30ml", "price": 599, "cogs_pct": 0.31, "cat": "Active Serums"},
            "DC-2-SALYCIL-100": {"name": "2% Salicylic Acid Face Wash", "price": 349, "cogs_pct": 0.32, "cat": "Active Serums"},
            "DC-1-HYALU-SUN-50": {"name": "1% Hyaluronic Tinted Sunscreen Gel", "price": 499, "cogs_pct": 0.30, "cat": "Active Serums"}
        }
    },
    "Aqualogica": {
        "weight": 0.12,
        "growth_vector": 1.35,
        "skus": {
            "AQ-DEW-SUN-50": {"name": "Radiance+ Dewy Sunscreen SPF 50", "price": 449, "cogs_pct": 0.29, "cat": "Sunscreen"},
            "AQ-HYDRA-GEL-50": {"name": "Hydrate+ Gel Gel Moisturizer", "price": 399, "cogs_pct": 0.31, "cat": "Skincare"}
        }
    },
    "BBlunt": {
        "weight": 0.08,
        "growth_vector": 1.20,
        "skus": {
            "BB-INT-SHAMP-300": {"name": "Intense Moisture Shampoo 300ml", "price": 399, "cogs_pct": 0.33, "cat": "Haircare"},
            "BB-ACT-SPRAY-150": {"name": "Blown Away Volumizing Spray", "price": 550, "cogs_pct": 0.34, "cat": "Haircare"}
        }
    }
}

CHANNELS = {
    "QuickCommerce-Blinkit": {"weight": 0.22, "rto_prob": 0.02},
    "QuickCommerce-Zepto": {"weight": 0.15, "rto_prob": 0.02},
    "QuickCommerce-Instamart": {"weight": 0.10, "rto_prob": 0.02},
    "Amazon India": {"weight": 0.18, "rto_prob": 0.09},
    "Nykaa Marketplace": {"weight": 0.12, "rto_prob": 0.06},
    "Native D2C Website": {"weight": 0.08, "rto_prob": 0.13},
    "Offline-General Trade": {"weight": 0.10, "rto_prob": 0.01},
    "Offline-Modern Trade": {"weight": 0.05, "rto_prob": 0.01}
}

COMPLAINTS = {
    "Skincare": ["Product Texture Too Sticky", "Skin Breakouts Reported", "Cap Seal Compromised", "Transit Delay"],
    "Haircare": ["Frizz Control Unsatisfactory", "Strong Herbal Scent", "Bottle Leaked In Box", "Wrong Item Sent"],
    "Active Serums": ["Purging/Initial Redness", "Slight Oxidization/Color Change", "Dropper Pipette Cracked"],
    "Sunscreen": ["White Cast Observed", "Pilling Under Makeup", "Pump Air-Locked"]
}

CAMPAIGNS = ["Meta Performance Conversion", "Google Shopping Smart PPC", "Blinkit Banner Takeover", "Celebrity Native Integration", "Festive Glow Maximizer"]
SENTIMENTS = ["positive", "neutral", "negative"]

# New Social Layer Anchors
SOCIAL_PLATFORMS = ["Instagram", "YouTube", "Moj", "Twitter"]
SOCIAL_POST_TYPES = ["reel", "shorts", "video_review", "static_post", "sponsored_mention"]
SOCIAL_TAGS = {
    "Mamaearth": ["#GoodnessInside", "#MamaearthHaul", "#PlasticPositiveBeauty"],
    "The Derma Co": ["#DermaCoFilterFree", "#ActiveSkincareIndia", "#ScienceBackedBeauty"],
    "Aqualogica": ["#AqualogicaDewy", "#WaterLockHydration", "#SunscreenEveryday"],
    "BBlunt": ["#BBluntSalonSecret", "#ShineLikeSalon", "#IndianHairCare"]
}

# ==============================================================================
# PIPELINE GENERATION STREAM ENGINE
# ==============================================================================
def run_stream():
    files = {
        "honasa_marketing.json": open("honasa_marketing.json", "w", encoding="utf-8"),
        "honasa_customers.json": open("honasa_customers.json", "w", encoding="utf-8"),
        "honasa_sales.json": open("honasa_sales.json", "w", encoding="utf-8"),
        "honasa_social.json": open("honasa_social.json", "w", encoding="utf-8")  # Added file
    }

    for name, f in files.items():
        layer = name.split('_')[1].replace('.json', '')
        f.write(f'{{\n  "corporate_parent": "Honasa Consumer Limited",\n  "layer": "{layer}",\n  "audit_standard": "IND-AS (Public Listed Compliance)",\n  "data": [\n')

    current_date = START_DATE
    counts = {k: 0 for k in files.keys()}
    brands = list(BRAND_PROFILES.keys())
    brand_weights = [BRAND_PROFILES[b]["weight"] for b in brands]
    
    channel_list = list(CHANNELS.keys())
    channel_weights = [CHANNELS[c]["weight"] for c in channel_list]

    print(f"Streaming full data with Social Layer (Scale Factor: {SCALE_FACTOR})...")

    while current_date <= END_DATE:
        date_str = current_date.strftime("%Y-%m-%d")
        
        day_modifier = 1.25 if current_date.weekday() in [5, 6] else 0.95
        if current_date.month in [10, 11]: day_modifier *= 1.45 

        # --- 1. TRANS-CHANNEL SALES DATA ---
        for _ in range(random.randint(15, 35) * SCALE_FACTOR):
            selected_brand = random.choices(brands, weights=brand_weights, k=1)[0]
            sku_pool = BRAND_PROFILES[selected_brand]["skus"]
            selected_sku = random.choice(list(sku_pool.keys()))
            sku_meta = sku_pool[selected_sku]
            selected_channel = random.choices(channel_list, weights=channel_weights, k=1)[0]
            
            avg_units = (DAILY_TARGET_REVENUE_POOL / len(sku_pool)) / sku_meta["price"]
            units_sold = int(avg_units * random.uniform(0.1, 0.4) * day_modifier)
            if units_sold == 0: units_sold = random.randint(5, 50)

            gross_revenue = int(units_sold * sku_meta["price"])
            cost_of_goods_sold = int(gross_revenue * sku_meta["cogs_pct"])
            rto_units = int(units_sold * CHANNELS[selected_channel]["rto_prob"] * random.uniform(0.6, 1.4))

            sales_record = {
                "date": date_str, "sku": selected_sku, "product_name": sku_meta["name"],
                "brand_label": selected_brand, "units_sold": units_sold,
                "gross_revenue_inr": gross_revenue, "cogs_inr": cost_of_goods_sold,
                "distribution_channel": selected_channel, "rto_units": rto_units
            }
            prefix = ",\n" if counts["honasa_sales.json"] > 0 else ""
            files["honasa_sales.json"].write(prefix + "    " + json.dumps(sales_record))
            counts["honasa_sales.json"] += 1

        # --- 2. ADVERTISING DATA ---
        for _ in range(random.randint(8, 16) * SCALE_FACTOR):
            selected_brand = random.choices(brands, weights=brand_weights, k=1)[0]
            sku_pool = BRAND_PROFILES[selected_brand]["skus"]
            selected_sku = random.choice(list(sku_pool.keys()))
            
            spend = random.randint(10000, 150000)
            ctr = round(random.uniform(1.6, 3.9), 2)
            impressions = int(spend * random.uniform(3.5, 7.0) * day_modifier)
            clicks = int(impressions * (ctr / 100))
            roas = round(random.uniform(2.1, 4.8) * (1.15 if "Conversion" in CAMPAIGNS else 0.9), 2)

            ads_record = {
                "date": date_str, "sku": selected_sku, "brand_label": selected_brand,
                "spend_inr": spend, "clicks": clicks, "impressions": impressions,
                "roas": roas, "ctr": ctr, "campaign_type": random.choice(CAMPAIGNS)
            }
            prefix = ",\n" if counts["honasa_marketing.json"] > 0 else ""
            files["honasa_marketing.json"].write(prefix + "    " + json.dumps(ads_record))
            counts["honasa_marketing.json"] += 1

        # --- 3. CUSTOMER EXPERIENCES DATA ---
        for _ in range(random.randint(5, 12) * SCALE_FACTOR):
            selected_brand = random.choices(brands, weights=brand_weights, k=1)[0]
            sku_pool = BRAND_PROFILES[selected_brand]["skus"]
            selected_sku = random.choice(list(sku_pool.keys()))
            cat = sku_pool[selected_sku]["cat"]

            customer_record = {
                "date": date_str, "sku": selected_sku, "brand_label": selected_brand,
                "support_tickets_logged": random.randint(5, 180), "avg_star_rating": round(random.uniform(3.6, 4.8), 1),
                "top_complaint_reason": random.choice(COMPLAINTS[cat]), "blended_sentiment": random.choice(SENTIMENTS)
            }
            prefix = ",\n" if counts["honasa_customers.json"] > 0 else ""
            files["honasa_customers.json"].write(prefix + "    " + json.dumps(customer_record))
            counts["honasa_customers.json"] += 1

        # --- 4. NEW: SOCIAL DATA LAYER ---
        for _ in range(random.randint(4, 10) * SCALE_FACTOR):
            selected_brand = random.choices(brands, weights=brand_weights, k=1)[0]
            likes = random.randint(1000, 120000)
            comments = int(likes * random.uniform(0.015, 0.07))
            shares = int(likes * random.uniform(0.03, 0.18))
            views = int(likes * random.randint(8, 45) * day_modifier)

            social_record = {
                "date": date_str,
                "brand_label": selected_brand,
                "platform": random.choice(SOCIAL_PLATFORMS),
                "content_format": random.choice(SOCIAL_POST_TYPES),
                "primary_hashtag": random.choice(SOCIAL_TAGS[selected_brand]),
                "metrics": {
                    "views": views,
                    "likes": likes,
                    "comments": comments,
                    "shares": shares
                },
                "audience_sentiment_split": random.choice(SENTIMENTS)
            }
            prefix = ",\n" if counts["honasa_social.json"] > 0 else ""
            files["honasa_social.json"].write(prefix + "    " + json.dumps(social_record))
            counts["honasa_social.json"] += 1

        current_date += timedelta(days=1)

    # Clean array closing tags
    for name, f in files.items():
        f.write("\n  ]\n}")
        f.close()
        print(f"✅ Generated '{name}' -> {counts[name]:,} rows compiled.")

if __name__ == "__main__":
    run_stream()