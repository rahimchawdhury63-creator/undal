# 14 · Maps, Geocoding, Routing & Delivery Zones (OpenStreetMap stack)

## 14.1 Rendering

Flutter: `flutter_map` (+ `latlong2`) over OSM raster tiles; Web/Admin: Leaflet. Tile usage policy compliance:
custom User-Agent via tile proxy on W1 (`/tiles/{z}/{x}/{y}` → tile.openstreetmap.org with 7-day edge cache + attribution
“© OpenStreetMap contributors” on every map) — caching slashes upstream load and speeds BD networks; if tile volume
outgrows courtesy limits, ADR path = self-host BD extract (documented, not v1). Brand-styled pins (vendor/rider/customer),
route polylines (OSRM geometry), zone polygons (semi-transparent Undal green), dark-mode tile filter.

## 14.2 Geocoding (search + reverse)

Nominatim public API **through W2 proxy only** (apps never call it directly): 1 req/s server throttle, cache forever by
normalised query / rounded coords (5 dp) in Postgres `geocode_cache`, `countrycodes=bd`, `accept-language` bn/en,
Plus-Code computation locally as fallback label (screenshots use Plus Codes — good for address-poor areas).
Address UX: search suggestions → pin fine-tune (drag) → structured fields (house/road/area + instructions) →
zone resolution verdict shown before save (“Delivery available ✓ Sylhet Sadar” / “Outside zones — nearest zone 1.2 km”).

## 14.3 Routing & ETAs

OSRM public demo server via W2 proxy+cache (OD-pair rounded 4 dp, 60 s TTL): `route` (distance/duration/geometry),
`table` for assignment matrices (capped sizes), profiles: driving (motorbike proxy) / cycling / walking (pickup).
Fallback chain: OSRM → cached → haversine × zone road-factor (default 1.35, learned nightly from completed trips)
with vehicle speed profiles. Self-host OSRM (BD extract on free-tier VM alternatives) is the documented scale ADR —
public-server fair-use is a launch bridge, stated plainly in Admin Health.

## 14.4 Delivery zones (Admin polygon studio — founder spec)

Leaflet draw/edit (polygon vertices, snap, undo), templates: **circle→polygon generator** (centre + radius), **city presets**
(hand-seeded starter polygons for Sylhet Sadar launch areas — coordinates to be drawn/verified by founder in Admin, not
invented by code), duplicate/merge, per-zone settings (fees, radii, surge bounds, batching, operating notes).
Validation: ≥3 points, area sanity, overlap warnings (vendor/customer resolution: smallest containing polygon wins).
Point-in-polygon: ray-casting in W2 over cached zone set (refreshed on write); vendor/customer rows store resolved `zone_id`.

## 14.5 Rider navigation handoff (D-10)

Big **Navigate** button per leg: Android intent `google.navigation:q={lat},{lng}&mode=d|b` → fallback `geo:{lat},{lng}?q=…`
→ fallback in-app OSRM polyline + turn list (text steps from OSRM). Return-to-Undal deep link in notification (“Back to delivery”).
Customer/vendor “directions to pickup” (pickup mode) uses the same handoff.

## 14.6 Location quality & privacy

GPS accuracy gating (rider session requires ≤50 m fix; order actions warn >100 m), mock-location detection flag,
significant-motion batching (battery), location permission education screens EN/BN, precise-location retained raw 7 days
then aggregated (file `09`), customer sees rider dot only while their order is active — after delivery the trail collapses
to “Delivered at {time}” (no permanent rider surveillance product).
