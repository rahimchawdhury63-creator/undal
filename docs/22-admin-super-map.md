<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 22 — The Super Map

> The brief: *"a full-screen OSM super-map showing all active riders, vendors and customers with
> unique beautiful SVG markers, and tapping any marker opens a deep-detail side panel with orders,
> route and contact."* This is the screen an operations lead keeps open all day. It must be
> beautiful, it must be fast with a thousand markers, and it must never lie about where someone
> is.

---

## 1. The screen

```
╔═══════════════════════════════════════════════════════════════════════════╗
║ ◉ COMMAND            🔍 ⌘K        47 orders · 23 riders · 41 vendors  ⚙  ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  ┌────────────┐                                                           ║
║  │ LAYERS     │              🛵                                           ║
║  │ ☑ Riders   │                      🏪                                   ║
║  │ ☑ Vendors  │           🏠                   🛵                          ║
║  │ ☑ Orders   │                 🛵                                        ║
║  │ ☑ Zones    │      🏪                    🏠                             ║
║  │ ☐ Heatmap  │                                      🏪                   ║
║  │ ☐ Forecast │              🏠        🛵                                 ║
║  │ ☐ Routes   │                                                           ║
║  │ ☐ Traffic  │                   🛵                                      ║
║  └────────────┘                                        🏪                 ║
║                                                                           ║
║  ┌────────────┐                                                           ║
║  │ FILTERS    │                                                           ║
║  │ Zone   ▾   │                                                           ║
║  │ State  ▾   │                                                           ║
║  │ Late only  │                                                           ║
║  └────────────┘                                                           ║
║                                                                           ║
║  © OpenStreetMap contributors            [−] [+]  [⌖]  [2D|3D]  [⛶]      ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

Full-bleed map. The chrome floats over it in translucent panels that can be collapsed to icons.
There is no page scroll — the map **is** the page.

---

## 2. Technology

| Concern | Choice | Why |
| --- | --- | --- |
| Renderer | **MapLibre GL JS** | WebGL; 2 000+ markers at 60 fps is not achievable with DOM markers |
| Fallback | **Leaflet** with canvas markers | For WebGL-less environments; capped at 300 markers with clustering, and the UI says it is in fallback mode |
| Tiles | OSM raster from `TILE_BASE_URL`, or a vector style when configured | Attribution permanent, §9 |
| Markers | SVG → signed-distance-field sprite atlas, uploaded once | One texture, one draw call per layer |
| Live data | SSE from `undal-realtime`, one stream, multiplexed | §4 |
| Geometry | `@turf/turf` for point-in-polygon, buffers and bearings | |
| Clustering | MapLibre's built-in cluster layer above 400 visible points | |

---

## 3. The markers

> *"unique beautiful SVG markers"*

Every marker is a purpose-drawn SVG, not an emoji and not a stock pin. They share one visual
system: a 44 × 52 px teardrop body, a 2 px stroke in the canvas colour so markers read against any
tile, a glyph in the centre, and state expressed through colour, ring and animation.

### 3.1 Rider markers

| Variant | Design |
| --- | --- |
| **Motorbike, idle** | Forest-green teardrop, white motorbike glyph, gentle 2 s breathing pulse |
| **Motorbike, to vendor** | Amber body, a small 🏪 pip on the shoulder, a directional arrow at the tip oriented to the bearing |
| **Motorbike, carrying** | Live-green body, a 📦 pip, a faint motion trail of the last 6 positions fading to transparent |
| **Motorbike, bundle** | Carrying variant plus a numeric badge (`2`, `3`) in a dark pill |
| **Bicycle** | Same four states with a bicycle glyph and a narrower body, visually lighter |
| **Signal lost** | Desaturated, hollow, a dashed ring, and a small clock showing the age of the fix |
| **Cash-locked** | A padlock pip |
| **Suspended** | Crimson body with a diagonal bar |
| **SOS** | Crimson, rapid pulse, a 120 px expanding halo, and it sorts above everything else on the map |

The bearing arrow rotates with eased interpolation, separately from the position tween, which is
what makes a moving rider look like a vehicle rather than a drifting dot.

### 3.2 Vendor markers

| Variant | Design |
| --- | --- |
| **Open** | White body, forest-green roof glyph, a thin green ring |
| **Busy** | Amber ring, a small flame pip |
| **Paused** | Grey ring, a pause pip, 60% opacity |
| **Closed** | Outline only, 40% opacity |
| **Unreachable** | Dashed crimson ring, slow pulse — the state an operator must notice |
| **With pending orders** | A count badge; the badge turns red when any order's accept countdown is under 30 s |

### 3.3 Customer / order markers

| Variant | Design |
| --- | --- |
| **Awaiting acceptance** | Small hollow circle, pulsing |
| **In preparation** | Filled circle with a cooking glyph |
| **Awaiting rider** | Filled with a magnifying glyph, pulsing faster as it ages |
| **En route** | Filled, connected to its rider by a thin animated dashed line |
| **Arrived** | A ring expanding and resetting on a 1.5 s loop |
| **Late** | Crimson fill with the minutes-over count in the badge |
| **Delivered (last 10 min)** | A soft green fade-out over 10 minutes, so an operator can see recent completions |

Customer markers show the **drop point**, never a home address unless the operator opens the
panel — and opening it is audited.

### 3.4 Accessibility and colour

Every state is distinguishable by **shape and animation as well as colour**. The palette is
checked against deuteranopia, protanopia and tritanopia simulations, and a colour-blind-safe mode
switches the four main hues to a tested alternative set. Marker size scales with a user
preference for operators with low vision.

---

## 4. Live data

One SSE stream carries everything:

```
GET /v1/admin/map/stream?zones=…&layers=riders,vendors,orders
```

| Event | Rate | Payload |
| --- | --- | --- |
| `snapshot` | Once on connect | Full state for the requested layers |
| `rider.move` | Per rider, as reported | Delta-encoded: id, Δlat, Δlon, bearing, speed, age |
| `rider.state` | On change | id, state, orders, cash |
| `vendor.state` | On change | id, open_state, pending count |
| `order.state` | On change | id, state, eta, flags |
| `exception` | On raise | kind, severity, subject, position |
| `tick` | Every 15 s | Server time, for staleness computation |

Positions come from **D1** ([`07`](07-d1-live-tracking.md)) — the same source the customer
tracking map uses, so the operator and the customer are never looking at different truths.

**Bandwidth:** with 50 riders moving, the stream averages **3.1 KB/s**. A `rider.move` delta is
19 bytes. The full snapshot for a 500-object city is 41 KB gzipped.

### 4.1 Interpolation

```ts
/**
 * Markers move smoothly between reported positions. The tween duration is
 * the ACTUAL interval since the last update, not a constant, so a rider
 * reporting every 25s moves slowly and continuously rather than jumping
 * once a second and freezing.
 *
 * We never extrapolate beyond a position's age + 50%: guessing where
 * somebody might be is how an operator ends up calling a rider who is
 * nowhere near where the map says. After that, the marker stops and starts
 * showing its age.
 */
function tweenDuration(prevTs: number, nextTs: number): number {
  return clamp(nextTs - prevTs, 250, 30_000);
}
```

Staleness ladder, identical to the customer app's:

| Fix age | Rendering |
| --- | --- |
| < 20 s | Normal |
| 20–60 s | A soft "updating" pulse |
| 60–180 s | Hollow marker, age label |
| > 180 s | Desaturated, dashed ring, "last seen 4m ago", and the marker stops moving entirely |

---

## 5. The detail panel

> *"tapping any marker opens a deep-detail side panel with orders, route and contact."*

Slides in from the right, 420 px (full-width below 840 px), with the map re-centring so the
selected marker is not under the panel.

### 5.1 Rider panel

```
┌──────────────────────────────────────────┐
│  ← Karim Rahman            ★ 4.8  ✕      │
│  🛵 Honda · DHA-METRO-LA-12-3456         │
│  ● CARRYING · 2 orders · bundle          │
├──────────────────────────────────────────┤
│  SHIFT                                   │
│  Started 14:02 · 6h 20m · Sylhet Central │
│  11 delivered · 48.2 km · ৳1,284 earned  │
│  Battery 54% · fix 8s ago · v2.4.1       │
├──────────────────────────────────────────┤
│  CASH                                    │
│  ৳2,140 of ৳3,500   ████████████░░░░ 61% │
│  Last settled: yesterday 21:14           │
├──────────────────────────────────────────┤
│  CURRENT ROUTE                           │
│  ● Rahman's Biriyani ✓ picked up 14:22   │
│  ◉ House 42, Shibganj     2.1 km · ~6m   │
│  ○ Lane 7, Shibganj       0.9 km · ~3m   │
│  [ show route on map ]                   │
├──────────────────────────────────────────┤
│  TODAY'S ORDERS                     11 ▾ │
├──────────────────────────────────────────┤
│  CONTACT                                 │
│  [ 📞 Call ]  [ 💬 Message ]  [ 🔔 Ping ]│
├──────────────────────────────────────────┤
│  ACTIONS                                 │
│  Force break · Force offline · Suspend   │
│  Adjust cash limit · Reassign orders     │
│  View dispatch history · Open audit      │
└──────────────────────────────────────────┘
```

**Ping** sends a `PRESENCE_CHECK` FCM that makes the rider's phone chirp once and immediately
report position — the fastest way to resolve "is this rider actually there?". It is rate-limited
to once per 2 minutes per rider and it is audited, because it is intrusive.

### 5.2 Vendor panel

Status, hours, today's order counts by state, prep accuracy, acceptance, the unreachable-incident
history, device health (last alarm delivery, app version, battery where reported), the pending
order list with live countdowns, contact, and actions (pause, force open, message, open Vendor
360).

### 5.3 Order panel

The full timeline with timestamps and actors, the fare derivation exactly as
[`10 §12`](10-fare-engine-math.md) renders it, the dispatch trace with the candidate table, the
rider's route, the customer's contact (revealing the phone number writes an audit row), the QR
scan record, and the action set — reassign, cancel, credit, escalate.

### 5.4 Multi-select

Rubber-band selection with a modifier key selects many markers. The panel becomes a bulk view:
counts by state, aggregate cash, and bulk actions (message all, force break all, reassign all)
each with a preview and a confirmation.

---

## 6. Layers

| Layer | Contents |
| --- | --- |
| **Riders** | §3.1 |
| **Vendors** | §3.2 |
| **Orders** | §3.3 |
| **Zones** | Polygon fills at 12% opacity with labelled boundaries; the active zone emphasised |
| **Heatmap** | Order density over a selectable window (15 min / 1 h / 24 h / 7 d), as a weighted MapLibre heatmap |
| **Forecast** | The Brain's 2-hour demand surface ([`09 §9`](09-undal-brain-overview.md)) as 500 m cells coloured by predicted orders, with a supply-gap overlay showing cells where predicted demand exceeds likely riders |
| **Routes** | Every active delivery's OSRM polyline, travelled portion dimmed |
| **Traffic** | Inferred from Undal's own riders' speeds versus the hour-of-week baseline — the same signal the weather inference uses. Honest about being an inference, not a traffic feed |
| **Coverage** | Union of all vendor service areas, showing gaps inside a zone where no vendor delivers |
| **Trails** | The last 30 minutes of every rider's path, for understanding a disputed delivery |

Layer state is persisted per operator. Only `Riders`, `Vendors`, `Orders` and `Zones` are on by
default, because a map with nine layers on is unreadable.

---

## 7. Performance

| Scenario | Budget | Technique |
| --- | --- | --- |
| 1 000 markers, 60 fps pan/zoom | Hard requirement | WebGL symbol layers, one sprite atlas, no DOM nodes |
| 50 riders moving continuously | < 8% CPU on a 2020 laptop | `requestAnimationFrame` tween over a typed-array position buffer; geometry updated once per frame, not once per event |
| Initial load | ≤ 1.2 s to first markers | Snapshot fetched in parallel with the style; markers render before tiles finish |
| Memory | ≤ 220 MB over an 8-hour session | Trails and delivered markers pruned on a fixed horizon; no unbounded event array |
| SSE reconnect | ≤ 2 s, no visible gap | `Last-Event-ID` resumption, then a delta snapshot |
| Tab backgrounded | Tween loop suspended, stream kept | `visibilitychange`; a full snapshot on return rather than replaying a backlog |

Marker positions live in a `Float64Array` indexed by a stable integer id, so a position update is
two array writes rather than an object allocation. This is the difference between a map that holds
60 fps for eight hours and one that garbage-collects into a stutter after twenty minutes.

---

## 8. Search and navigation

| Input | Result |
| --- | --- |
| Order code (`7K2M9QX4`) | Flies to the order, opens its panel |
| Rider or vendor name | Fuzzy list, then fly-to |
| Phone number | Resolves to a customer, rider or vendor; **audited** |
| An address | Nominatim geocode with attribution, drops a temporary pin |
| `lat,lon` | Flies there |
| `zone:sylhet-central` | Fits the zone bounds and filters to it |
| `late:>15` | Filters to orders more than 15 minutes past ETA |
| `cash:>3000` | Filters to riders over a cash threshold |

Camera moves use a 900 ms eased `flyTo` with a curve that keeps context visible — instant jumps
lose the operator's sense of place.

---

## 9. Attribution and licensing

**"© OpenStreetMap contributors"** is permanently rendered in the bottom-right, always legible,
never covered by a panel, never dismissible, and linked to `openstreetmap.org/copyright`. Where
Nominatim or OSRM are used, their attribution appears alongside. The `osm-attribution` CI job
asserts the component's presence in every map-bearing route and fails the build if it is removed
or hidden by CSS.

This is a licence obligation, not a courtesy, and the platform depends entirely on free OSM
infrastructure.

---

## 10. Privacy

| Control | Rule |
| --- | --- |
| Customer positions | Only the **drop point** of an active order. No home addresses on the map |
| Revealing a phone number | Writes an audit row with the operator, the subject and a reason |
| Rider trails | 30 minutes on the map; the underlying D1 ring is 120 positions and is erased at shift end ([`07 §9`](07-d1-live-tracking.md)) |
| Historical replay | Requires `ops.map.replay` and is limited to 7 days, from `order_state_events` rather than from location history |
| Off-shift riders | Not on the map. There is no position to show, because none is stored |
| Export | Map data export requires `ANALYST` or above and is audited |
| Screenshot watermark | An optional mode stamps the operator's name and timestamp over the map, for operations teams that share screenshots |

---

## 11. Replay

A time scrubber over the last 7 days, reconstructing the map from `order_state_events` and
retained position summaries. Used for incident review: an operator can watch exactly what happened
during a bad Friday evening, at 1×, 10× or 60× speed, with the exception queue replaying
alongside.

Replay is explicitly **not** backed by full location history — that data is deleted. Rider paths
in replay are reconstructed from the OSRM route plus the state transitions, and the UI labels them
as reconstructed rather than recorded. Saying so matters: an operator must not mistake an
interpolation for evidence.

---

## 12. Testing

| Test | Count |
| --- | --- |
| Marker rendering, every variant | 34 |
| Interpolation and the staleness ladder | 19 |
| SSE handling, reconnect, resumption, out-of-order events | 23 |
| Panel content for each subject type | 28 |
| Bulk selection and bulk actions | 16 |
| Layer toggles and persistence | 11 |
| Search grammar | 24 |
| Attribution presence | 1 CI job |
| Privacy — no home address in any payload reaching the map | 9 |
| Audit on reveal and ping | 6 |
| **Performance** | 1 000 synthetic markers at 60 fps; an 8-hour soak with no memory growth beyond budget |
| Fallback | Leaflet path renders and announces itself |

---

## 13. Reading on

Next: [`23-onboarding-kyc.md`](23-onboarding-kyc.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
