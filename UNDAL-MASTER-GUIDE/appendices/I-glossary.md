# Appendix I · Glossary (shared language for founder, builder, support)

| Term | Meaning (Undal-specific) | বাংলা |
|---|---|---|
| COD | Cash on Delivery — customer pays rider in cash; Undal v1s only payment mode. | ক্যাশ অন ডেলিভারি |
| Poisha | 1/100 of a taka; the integer unit for ALL money in Undal. | পয়সা |
| SDR | Supply-Demand Ratio = active riders / active orders in a zone (surge input). | — |
| Flash Box | Undals timed discount campaign (default 25% class), vendor opt-in. | ফ্ল্যাশ বক্স |
| KYC | Know Your Customer — identity/business document verification (file 21). | — |
| NID | National ID Card (Bangladesh). | জাতীয় পরিচয়পত্র |
| BIN/TIN | Business/Taxpayer Identification Numbers (BD). | — |
| TrxID | bKash/Nagad transaction ID used as payout/remittance proof (globally unique in Undal). | — |
| Data-only FCM | Push with data payload and NO notification payload — wakes app code (file 07). | — |
| RTDB | Firebase Realtime Database — Undals ephemeral live layer, never the money truth. | — |
| Connection economy | Leasing RTDB connections only to active-order participants (file 06). | — |
| Geohash | Text encoding of lat/lng enabling prefix proximity queries. | — |
| OSRM/Nominatim | Free OSM routing / geocoding engines. | — |
| Zone | Drawn polygon service area owning fees/dispatch config. | এলাকা |
| Batch/Bundle | One rider, multiple orders, sequenced pickups/drops (file 12). | — |
| Deadhead | Rider->vendor unpaid-position leg, paid at 50% in Undal fare. | — |
| Cash gate | Rider session block until COD cash remitted (file 18). | — |
| Home Kitchen | Home-chef vendor type (lighter KYC, privacy-protected). | হোম কিচেন |
| Cloud Kitchen | Delivery-only professional kitchen, no dine-in. | ক্লাউড কিচেন |
| Golden vector | Pre-computed expected money/fare result asserted in tests (Appendix F). | — |
| RLS | Row Level Security — per-row Postgres access law. | — |
| App Links | Verified https links that open the Android app. | — |
| Prerender/SSG | Building real HTML at deploy time so crawlers see content (file 19). | — |