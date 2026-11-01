<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 04 — Motion and Interaction

> Motion is how Undal communicates causality: *this* became *that*, and here is the path it took. A
> platform that moves well feels fast even when it is not. This document specifies every animation in
> the product with the numbers to implement it, on both Compose and the web, and the rule that
> governs when it must not run at all.

---

## 1. The five motion principles

1. **Everything that moves has a cause.** No ambient animation, no decorative loops, no motion that
   fires without an input or a real state change. The one exception is the alarm, which must be
   impossible to ignore.
2. **Objects persist.** When a thing changes screen, it *travels*. A dish on a card and the dish on
   the detail hero are the same object, so it flies. A cross-fade between two pictures of the same
   object is a lie about continuity.
3. **Springs for interaction, curves for choreography.** Anything the user's finger initiated uses a
   spring, because springs respond to velocity. Anything the system initiated — a sheet appearing, a
   toast arriving — uses an eased curve with a fixed duration.
4. **Fast in, gentle out.** Enter in 180–260 ms. Exit in 120–180 ms. Users wait for things to arrive;
   they never want to wait for things to leave.
5. **Reduce motion means reduce motion.** Not "slightly less". Under `prefers-reduced-motion` or
   `ANIMATOR_DURATION_SCALE == 0`, every transform and every position animation becomes an opacity
   cross-fade at 120 ms. Nothing translates, nothing scales, nothing rotates. Enforced by a lint that
   rejects any animation declaration lacking a reduced variant.

---

## 2. The duration and easing scale

| Token | Duration | Use |
| --- | --- | --- |
| `motion.duration.instant` | 80 ms | Ripple start, haptic-paired flash |
| `motion.duration.fast` | 120 ms | Exit, hover, small state change |
| `motion.duration.quick` | 180 ms | Checkbox tick, chip fill, badge pop |
| `motion.duration.base` | 240 ms | **Default.** Enter, expand, sheet detent |
| `motion.duration.slow` | 320 ms | Shared-element flight, page transition |
| `motion.duration.slower` | 420 ms | Full-screen takeover, map fly-to |
| `motion.duration.deliberate` | 640 ms | Success celebration, route draw-on |

| Token | Cubic-bézier | Character |
| --- | --- | --- |
| `motion.ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` | The default. Decelerates hard. |
| `motion.ease.enter` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Things arriving |
| `motion.ease.exit` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Things leaving |
| `motion.ease.emphasised` | `cubic-bezier(0.2, 0, 0, 1)` with a 0.35 split | Large, important movement |
| `motion.ease.linear` | `linear` | Progress, countdown, marquee only |

### 2.1 Springs

| Token | Damping ratio | Stiffness | Visible character |
| --- | --- | --- | --- |
| `motion.spring.tight` | 1.0 | 1400 | No overshoot. Precise. Steppers, toggles. |
| `motion.spring.snappy` | 0.85 | 700 | Barely perceptible overshoot. Default for touch. |
| `motion.spring.bouncy` | 0.72 | 380 | Visible 3–5% overshoot. The cart capsule, the `+` morph. |
| `motion.spring.gentle` | 0.9 | 220 | Slow, soft. Sheets, large panels. |
| `motion.spring.map` | 1.0 | 160 | Critically damped, long. Marker interpolation. |

**Compose**

```kotlin
// android/core-design/src/main/kotlin/bd/undal/design/motion/UndalSprings.kt
object UndalSprings {
    val Tight  = spring<Float>(dampingRatio = 1.00f, stiffness = 1400f)
    val Snappy = spring<Float>(dampingRatio = 0.85f, stiffness =  700f)
    val Bouncy = spring<Float>(dampingRatio = 0.72f, stiffness =  380f)
    val Gentle = spring<Float>(dampingRatio = 0.90f, stiffness =  220f)
    val Map    = spring<Float>(dampingRatio = 1.00f, stiffness =  160f)
}
```

**Web** — springs are expressed as generated keyframes, pre-computed at build time by
`packages/ui/src/motion/spring-to-keyframes.ts`, so no runtime physics library ships to the browser.
A 0.72/380 spring becomes a 24-step `@keyframes` block of 1.1 KB gzipped.

---

## 3. The signature: the shared-element dish flight

**Source:** motion reference A, 12.0–14.5 s ([`02 §3.1`](02-reference-analysis.md)).

A dish image on a card becomes the hero image on the dish sheet by **travelling**, while everything
else cross-fades.

### 3.1 Specification

| Property | From | To | Timing |
| --- | --- | --- | --- |
| Image bounds | Card image rect | Hero rect | 320 ms `motion.ease.emphasised` |
| Image corner radius | `radius.lg` (20) | `radius.2xl` (36) | same, interpolated |
| Card background | opacity 1 | opacity 0 | 120 ms `exit`, starts at 0 ms |
| Sheet background | opacity 0 | opacity 1 | 240 ms `enter`, starts at 60 ms |
| Sheet content | translateY +24 px, opacity 0 | 0, 1 | 260 ms `enter`, starts at 120 ms, **staggered 40 ms per block** |
| Scrim | 0 | 0.56 | 240 ms `enter` |
| Back gesture | — | reverses the whole thing, velocity-tracked | spring `Snappy` |

The reverse is **not** a replay backwards. It is the same transition with `exit` easing and a 240 ms
duration, and if the user is dragging, it follows the finger with a spring.

### 3.2 Compose

```kotlin
// Uses SharedTransitionLayout (Compose 1.7+). The key is stable across both composables,
// which is what lets the runtime match them.
SharedTransitionLayout {
    AnimatedContent(targetState = route, label = "dish-flight") { current ->
        when (current) {
            is Route.VendorMenu -> DishCard(
                modifier = Modifier.sharedElement(
                    rememberSharedContentState(key = "dish-image-${dish.id}"),
                    animatedVisibilityScope = this@AnimatedContent,
                    boundsTransform = { _, _ -> tween(320, easing = UndalEasing.Emphasised) },
                ),
            )
            is Route.DishSheet -> DishHero(
                modifier = Modifier.sharedElement(
                    rememberSharedContentState(key = "dish-image-${dish.id}"),
                    animatedVisibilityScope = this@AnimatedContent,
                    boundsTransform = { _, _ -> tween(320, easing = UndalEasing.Emphasised) },
                ),
            )
        }
    }
}
```

### 3.3 Web

View Transitions API with a `view-transition-name` matched on both elements:

```css
.dish-card__image { view-transition-name: dish-image; }
.dish-hero__image { view-transition-name: dish-image; }

::view-transition-old(dish-image),
::view-transition-new(dish-image) {
  animation-duration: 320ms;
  animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
}
```

**Fallback** where View Transitions is unsupported: a 240 ms cross-fade plus a 12 px upward
translate on the sheet. The fallback is tested, not assumed — `responsive-matrix` runs one pass with
the API force-disabled.

### 3.4 Where the flight is used

| From | To | Key |
| --- | --- | --- |
| Dish card | Dish sheet | `dish-image-{id}` |
| Vendor card | Vendor storefront | `vendor-cover-{id}` |
| Order row | Order detail | `order-card-{id}` |
| Rider avatar in tracking | Rider detail sheet | `rider-avatar-{id}` |
| Map marker | Inspector header | `marker-{type}-{id}` |
| Invoice row | Invoice preview | `invoice-{id}` |

---

## 4. The floating cart capsule

**Source:** motion reference B, persistent ([`02 §4.1`](02-reference-analysis.md)). The best idea in
either reference.

### 4.1 Anatomy

```
 ┌──────┐   ┌──────────────────────────────┐   ┌──────┐
 │  ☰   │   │  🛍  2   ┌──────────┐        │   │  👤  │
 │ 48dp │   │          │  ৳ 486   │        │   │ 48dp │
 └──────┘   │          └──────────┘        │   └──────┘
  circle    └──────────────────────────────┘    circle
  #0C1F1C          capsule #0C1F1C              #0C1F1C
                   inner pill #FFFFFF
```

- Sits `space.4` above the bottom safe-area inset, horizontally centred, `max-width: 420 px`.
- `shadow.capsule`.
- Height 56 dp. Inner pill height 36 dp, `radius.full`, `space.3` horizontal padding.

### 4.2 Behaviours

| Event | Animation |
| --- | --- |
| Cart becomes non-empty | Enter: translateY +80 → 0, scale 0.9 → 1, opacity 0 → 1, `spring.bouncy`, 260 ms |
| Cart becomes empty | Exit: reverse, `ease.exit`, 160 ms |
| Item added | Capsule scales 1 → 1.04 → 1 (`spring.bouncy`, 220 ms); bag glyph does a 6° wiggle; count badge pops `spring.tight` |
| Total changes | **Digits roll.** Each changed digit slides up (increase) or down (decrease) by its own line height over 220 ms, staggered 24 ms from the rightmost digit. Unchanged digits do not move. |
| Scrolling down | Capsule does **not** hide. It is the one piece of chrome that is always present. |
| Keyboard opens | Capsule animates out (160 ms) and returns on close |
| Tapped | Scales to 0.96 (80 ms) then flies to the cart sheet as a shared element keyed `cart-capsule` |

### 4.3 The rolling digit

```kotlin
// android/core-design/src/main/kotlin/bd/undal/design/money/RollingDigits.kt
@Composable
fun RollingDigits(value: Long, style: TextStyle) {
    val digits = remember(value) { value.toString().toCharArray().toList() }
    Row {
        digits.forEachIndexed { index, digit ->
            AnimatedContent(
                targetState = digit,
                transitionSpec = {
                    val up = targetState > initialState
                    val delay = (digits.size - index - 1) * 24
                    (slideInVertically(tween(220, delay)) { h -> if (up) h else -h } + fadeIn(tween(220, delay)))
                        .togetherWith(
                            slideOutVertically(tween(220, delay)) { h -> if (up) -h else h } + fadeOut(tween(220, delay))
                        )
                },
                label = "digit-$index",
            ) { d -> Text(d.toString(), style = style) }  // style carries "tnum"
        }
    }
}
```

Tabular figures are mandatory here — without them the capsule width jitters as digits change, and the
jitter is far more noticeable than the roll.

---

## 5. The `+` → stepper morph

**Source:** motion reference B, 6.0–8.0 s.

A 36 dp circular `+` button stretches horizontally into a `− 1 +` capsule.

| Phase | What moves | Timing |
| --- | --- | --- |
| 0 → 1 | Container width 36 → 108 dp | `spring.bouncy`, overshoots to ~112 dp |
| 0 → 1 | `+` glyph translates from centre to the right third | same spring, follows the container |
| 0 → 1 | `−` glyph fades in at the left third, opacity 0 → 1 | 120 ms, delayed 60 ms |
| 0 → 1 | Count `1` scales 0.6 → 1 with opacity | `spring.tight`, delayed 80 ms |
| n → n±1 | Count rolls (see §4.3) | 180 ms |
| 1 → 0 | Container collapses, `−` fades out, `+` returns to centre | `ease.exit`, 160 ms, no overshoot |

**Web implementation** uses a CSS grid whose `grid-template-columns` transitions from `0fr 0fr 1fr`
to `1fr 1fr 1fr`. This morphs without triggering layout on the parent, which is what keeps it at
60 fps inside a scrolling grid:

```css
.stepper {
  display: grid;
  grid-template-columns: 0fr 0fr 1fr;
  transition: grid-template-columns 260ms var(--motion-ease-standard);
}
.stepper[data-active="true"] { grid-template-columns: 1fr 1fr 1fr; }
.stepper > * { overflow: hidden; min-width: 0; }
```

Haptics: `HapticFeedbackConstants.CONTEXT_CLICK` on every increment, `CLOCK_TICK` on decrement, and a
`REJECT` when hitting the stock ceiling.

---

## 6. The condensing header

**Source:** motion reference B, 1.5–5.0 s.

Driven **continuously by scroll offset**, never by a threshold. A snap at a threshold is the single
most common way a good header is ruined.

### 6.1 The interpolation

Let `p = clamp(scrollOffset / collapseDistance, 0, 1)` where `collapseDistance = 120 dp`.

| Element | At `p = 0` | At `p = 1` | Curve |
| --- | --- | --- | --- |
| Header height | 148 dp | 56 dp | linear in `p` |
| Location label size | `heading.lg` | `label.md` | linear |
| Location label position | left, 2nd line | left, centred on the single line | linear |
| Mode switcher | below the label | inline, right of the label | linear |
| Background illustration | opacity 1 | opacity 0 | `p²` (fades late) |
| Backdrop blur | 0 px | 18 px | `p` |
| Background colour alpha | 0 | 0.86 | `p` |
| Bottom hairline | opacity 0 | opacity 1 | `p³` (appears only at the very end) |
| Circular buttons | 44 dp | 38 dp | linear |
| Content sheet corner radius | `radius.2xl` | 0 | `p` |

### 6.2 Compose

```kotlin
val collapse by remember {
    derivedStateOf { (listState.firstVisibleItemScrollOffset / collapsePx).coerceIn(0f, 1f) }
}
```

`derivedStateOf` is essential: it limits recomposition to the header subtree. Reading
`firstVisibleItemScrollOffset` directly in the header composable recomposes it on every frame of
every scroll, which is the difference between 60 fps and 40 fps on a budget phone.

### 6.3 Web

A single `IntersectionObserver` sentinel plus a `scroll` listener on a passive handler writing one
CSS custom property:

```js
// One property write per frame, rAF-throttled. The rest is pure CSS.
el.style.setProperty('--collapse', String(p));
```

No layout reads in the handler. All dependent styles are `calc()` expressions on `--collapse`.

---

## 7. The alarm takeover

**Source:** the brief. This is the most important animation in the platform because it is the one
that wakes someone up.

### 7.1 Entrance (partner receives an order)

| t | What |
| --- | --- |
| 0 ms | FCM data message arrives; foreground service starts; audio begins. **Audio is never gated on animation.** |
| 0 ms | Screen turns on (`FLAG_TURN_SCREEN_ON` + `setShowWhenLocked`) |
| 0–120 ms | Scrim fades in from transparent to `#0C1F1C` at 0.92 |
| 60–320 ms | The order card rises: translateY +120 → 0, scale 0.92 → 1, `spring.bouncy` |
| 120 ms | First haptic: a 3-pulse `VibrationEffect.createWaveform(longArrayOf(0, 180, 90, 180, 90, 240), -1)` |
| 200–560 ms | Content staggers in: vendor line → item list → total → countdown ring → buttons, 60 ms apart |
| 320 ms+ | The accent border **pulses**: a 2 px magenta stroke animating opacity 0.4 ↔ 1.0 on a 1200 ms sine loop, synchronised to the audio loop's 8 s period at 1/6.67 |
| continuous | The countdown ring sweeps, linear, colour forest → amber at 60% → red at 85% |

### 7.2 Why the pulse is synchronised to the audio

The alarm file is 8.000 s. The border pulse is 1200 ms. These are not commensurate, deliberately —
a perfectly synchronised visual and audio pulse creates a hypnotic rhythm that people stop noticing.
A slight phase drift keeps the signal salient over minutes. This is a real perceptual effect and it
is why the numbers are 8 000 and 1 200 rather than 8 000 and 1 000.

### 7.3 Exit

| Action | Animation |
| --- | --- |
| Accept | Audio stops **immediately** (not faded). Button fills with a radial wipe from the touch point, 240 ms. A tick draws on, 180 ms. Card scales to 1.02 then exits upward, 220 ms. |
| Reject | Audio stops. Reject sheet slides up over the card, 240 ms `ease.enter`. |
| Timeout | Audio drops to the 3-pulse fallback. Card dims to 0.6 opacity and shows "Still waiting — tap to respond". |

---

## 8. Map motion

| Animation | Specification |
| --- | --- |
| **Marker interpolation** | Rider positions arrive every ~100 m. Between updates the marker is animated along the *routed path*, not the straight line, at the rider's last known speed, using `spring.map`. If a new position arrives that diverges > 60 m from the predicted point, the marker re-paths with a 400 ms ease rather than teleporting. Full algorithm: [`07 §6`](07-d1-live-tracking.md). |
| **Bearing rotation** | The marker rotates to the travel bearing with a shortest-arc interpolation over 300 ms. Never spins the long way round. |
| **Route draw-on** | `stroke-dashoffset` from path-length to 0 over 640 ms `ease.emphasised`, with a 3 px white casing drawn first and the coloured line drawn over it. |
| **Fly-to** | `map.flyTo` with `curve: 1.42`, `speed: 1.2`, capped at 1 200 ms regardless of distance. |
| **Cluster expand** | Children spiral out from the cluster centre over 320 ms, stagger 20 ms, `spring.snappy`. |
| **Zone polygon draw** | Vertices appear in sequence, 40 ms apart; the fill cross-fades in once the ring closes. |
| **Live pulse** | A ring around active riders: scale 1 → 2.2, opacity 0.5 → 0, 2 000 ms, `ease.out`, infinite. **This is the only infinite animation in the platform** and it is disabled under reduce-motion and when more than 120 markers are visible. |
| **Heatmap transition** | Interpolates the colour ramp over 400 ms when the time window changes. |

---

## 9. List and page motion

| Animation | Specification |
| --- | --- |
| **Staggered list entry** | First paint only, never on scroll. Items translateY +16 → 0 and fade in, 240 ms, 40 ms stagger, capped at 8 items (beyond that everything after the 8th appears with the 8th). |
| **Pull to refresh** | A custom indicator: the Undal bird's bindle sack swings with the pull, then spins. Not a generic spinner. Over-scroll is rubber-banded at 0.4 resistance. |
| **Skeleton → content** | Cross-fade 180 ms. The skeleton's layout must exactly match the content's layout, so nothing jumps. |
| **Page push (Android)** | Enter: translateX +12% → 0 with fade, 300 ms `ease.emphasised`. Exit: translateX 0 → −4% with fade to 0.7, 300 ms. The outgoing page moving *less* than the incoming is what creates the depth. |
| **Page transition (web)** | View Transitions with the same offsets. |
| **Bottom sheet detents** | Drag follows the finger 1:1. Release settles with `spring.gentle`, and the target detent is chosen by projecting the fling velocity 180 ms forward, not by the release position. |
| **Tab indicator** | Slides with `spring.snappy`; width also animates when tabs have different widths. |
| **Accordion** | `animateContentSize` with `spring.gentle`; the chevron rotates 180° over the same duration. |
| **Toast** | Enters from the bottom, translateY +40 → 0, 240 ms `spring.snappy`. Auto-dismisses after 4 s, or 7 s if it has an action. Stacks up to 3, older ones scaling to 0.95 and dimming. |

---

## 10. Micro-interactions

| Element | Interaction |
| --- | --- |
| Any pressable card | `scale 1 → 0.985` over 80 ms on press down; releases with `spring.snappy`. Shadow softens from `md` to `sm` on press, which reads as the card being pushed toward the surface. |
| Primary button | Press scales to 0.97; a ripple originates at the touch point; on release, a 1.01 overshoot. |
| Switch | Thumb travels with `spring.bouncy`; the track colour crosses over at 50% of travel, not at the start. |
| Checkbox | Box fills over 120 ms; the tick path draws with `stroke-dashoffset` over 180 ms, starting at 80 ms. |
| Heart (favourite) | Scale 1 → 0.8 → 1.25 → 1 over 420 ms `spring.bouncy`; six small particles burst outward and fade; fill colour wipes from the centre. |
| Rating stars | Tapping star *n* fills stars 1..n in sequence, 50 ms apart. |
| Chip filter | Fill sweeps from the leading edge, 180 ms; the label colour crosses at 60% of the sweep. |
| Text field focus | Label floats up and shrinks (180 ms `spring.tight`); the underline grows from the centre outward (180 ms). |
| Error shake | translateX `0 → −8 → 6 → −4 → 2 → 0` over 320 ms. Paired with a haptic `REJECT`. Used **only** for invalid credentials and a failed QR scan. |
| Success tick | A circle scales in (`spring.bouncy`), then the tick path draws (180 ms), then a single ring pulses outward once. 640 ms total. |
| Copy-to-clipboard | The icon morphs to a tick for 1 200 ms then morphs back. |
| Countdown ring | `stroke-dashoffset`, linear, updated via `requestAnimationFrame` / `withInfiniteAnimationFrameNanos`. Never driven by a 1 Hz timer, which visibly stutters. |
| QR scan success | The viewfinder corners snap inward, flash green, and a strong haptic fires, all within 120 ms of detection. |
| Prep-time dial | Each `+`/`−` rolls the number and gives a `CLOCK_TICK` haptic. Holding accelerates after 600 ms to 4 steps/second. |

---

## 11. Choreography of the critical flows

### 11.1 Place order → vendor hears the alarm

```
Customer taps "Place order"
  │  0 ms    Button enters loading (label → 3-dot pulse, width unchanged)
  │  0 ms    Optimistic: a draft order row springs into "Your orders"
  │ ~180 ms  Worker ACKs. Button fills with a radial wipe; tick draws on.
  │  220 ms  Full-screen success: the Undal bird marks the order; the
  │          order code types on character by character, 28 ms per char
  │  640 ms  Auto-navigates to tracking; the success tick flies to become
  │          the first node of the order timeline (shared element)
  │
  └─► Worker fires FCM within ~120 ms of commit
         │
         └─► Partner device, app swiped away, screen locked
                │  ~400–1400 ms  FCM delivered
                │  +0 ms         Service starts, audio begins
                │  +40 ms        Screen on, takeover animates (§7.1)
                └─  Total customer-tap → vendor-hears: typically under 2 s
```

The 2-second budget is non-negotiable 21 and is asserted in CI by `latency-budget`.

### 11.2 Rider accepts an offer

```
Offer card slides up with the alarm (§7 reduced: 25 s ring, softer pulse)
  │ Rider drags the "Accept" slider right  ──► follows the finger 1:1
  │ Past 65% of travel, it commits even on release (velocity-projected)
  │ On commit: the slider fills green, the ring collapses into a tick,
  │            audio stops, strong haptic
  │ 240 ms:    the card morphs into the active-delivery header
  │ 320 ms:    the map flies to fit vendor + rider, route draws on (§8)
  └ 640 ms:    the "Navigate" button springs up from the bottom
```

### 11.3 QR pickup

```
Rider taps "Scan to pick up"
  │ Camera sheet rises from the bottom (280 ms, spring.gentle)
  │ Viewfinder corners breathe gently (scale 1 ↔ 1.03, 1800 ms)
  │ On detect:  corners snap in, flash green, strong haptic (<120 ms)
  │ Valid:      sheet collapses, order state badge morphs PLACED→PICKED_UP
  │             with a colour cross-fade and a label roll
  │ Invalid:    error shake, red corners, a clear line of copy naming
  │             which order the code actually belongs to
```

---

## 12. Performance budget

| Metric | Budget | Measured by |
| --- | --- | --- |
| Frame time, app lists | ≤ 16.6 ms p99 | Macrobenchmark `FrameTimingMetric` |
| Frame time, command map with 500 markers | ≤ 16.6 ms p95 | Playwright trace + `performance.measure` |
| Jank frames during the dish flight | 0 | Macrobenchmark |
| Main-thread work per scroll frame (web) | ≤ 4 ms | Lighthouse trace |
| Animation-triggered layout | **0** — transforms and opacity only | `will-change` audit + a CI check that greps for animated `width`/`height`/`top`/`left` outside the three approved morph components |
| Compose recompositions per scroll frame | ≤ 3 subtrees | Compose compiler metrics, asserted in CI |

### 12.1 The three components allowed to animate layout

The `no-layout-animation` lint has exactly three exemptions, each justified:

1. `UndalStepper` — the grid-column morph (§5). Measured at 0.4 ms/frame; the alternative (transform
   on an absolutely-positioned child) breaks text centring at `xxs`.
2. `UndalAccordion` — `animateContentSize`. Unavoidable, and it only runs on an explicit tap.
3. `UndalCollapsingHeader` — height interpolation. Confined to a subtree with `contain: layout`.

---

## 13. Reduce-motion variants

| Normal | Reduced |
| --- | --- |
| Shared-element flight | 120 ms cross-fade |
| Cart capsule spring entry | 120 ms fade |
| Digit roll | Instant swap |
| `+` → stepper morph | Instant swap |
| Header condensation | Still continuous — this is layout, not decoration, and removing it breaks the scroll relationship. Only the blur and illustration fade are removed. |
| Alarm border pulse | Static 2 px magenta border. **Audio and haptics are unchanged.** |
| Map live pulse | Removed |
| Marker interpolation | Still interpolates — a teleporting marker is worse for everyone, including users with vestibular sensitivity. Duration halved. |
| Route draw-on | Instant |
| Stagger | Removed; all items fade together |
| Pull-to-refresh swing | Static indicator with an opacity pulse |
| Error shake | Removed; border turns red and the haptic fires |
| Success celebration | Tick appears instantly |

Note the two deliberate exceptions. Reduce-motion is about avoiding vestibular triggers from large,
unexpected movement — it is not an instruction to make the product worse at conveying state. A
marker that teleports communicates *less* and is more disorienting, not less.

---

## 14. Reading on

Next: [`05-system-architecture.md`](05-system-architecture.md) — the three Workers and how a request
actually flows.

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
