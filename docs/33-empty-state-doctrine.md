<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 33 — Empty State Doctrine

> The brief: *"the platform should work with zero data and tell users 'no vendors'"* and, equally
> binding, *"no demo data, no seed data."* Those two requirements together mean the platform's
> **first** state — the state it is in on the day it launches — is the empty one. It must be the
> most carefully designed state in the product, not an afterthought.

---

## 1. The doctrine

Four rules, applied without exception across all 283 app screens and every admin table.

| # | Rule |
| --- | --- |
| **1** | **An empty state is never an error.** No red, no warning icon, no apologetic tone for a situation nobody caused |
| **2** | **It always says what is true, specifically.** "No restaurants deliver to Shibganj yet" — not "No results" |
| **3** | **It always offers at least one action.** A screen with nothing to do is a dead end, and a dead end is where users leave |
| **4** | **It is a designed screen**, with an illustration, real typography and the same polish as the populated state. A centred grey "Empty" string is a bug |

---

## 2. The anatomy

```
            ╭──────────────────────╮
            │                      │
            │     [illustration]   │      ← 44 bespoke SVGs, brand palette,
            │                      │        180dp, animated on entry
            ╰──────────────────────╯

              No restaurants here yet          ← headline, 20sp, ink

        Undal hasn't reached Shibganj yet.      ← body, 15sp, 80% ink,
        We're working on it.                      max 2 lines, specific

        ┌─────────────────────────────┐
        │   Notify me when we're live │          ← primary action
        └─────────────────────────────┘
          Change location                        ← secondary action

        Know a restaurant that should            ← tertiary, optional
        be here?  Suggest one                      and genuinely useful
```

Entry animation: the illustration fades and scales from 0.94 over 320 ms with the `Gentle` spring,
the text staggers in at 40 ms intervals, and the actions arrive last. It is brief and it signals
that the screen was built on purpose.

---

## 3. The forty-four empty states

### 3.1 Customer app (17)

| # | State | Headline | Actions |
| --- | --- | --- | --- |
| C1 | No zone covers this location | "Undal isn't here yet" | Notify me · Change location · Suggest a restaurant |
| C2 | Zone exists but is inactive | "We're paused in Shibganj" | Notify me · Change location |
| C3 | Zone active, no vendors | "No restaurants here yet" | Notify me · Change location · Suggest a restaurant |
| C4 | All vendors closed | "Everyone's closed right now" | Show opening times · Browse anyway · Notify me at opening |
| C5 | Search found nothing | "No results for 'sushi'" | Clear search · Browse all · Suggest a restaurant |
| C6 | Filters exclude everything | "No restaurants match these filters" | Clear filters · Remove one filter (named) |
| C7 | Outside a vendor's delivery radius | "Rahman's doesn't deliver this far" | Switch to pick-up · Change address · Find nearby |
| C8 | Empty cart | "Your cart is empty" | Browse restaurants · Order again from history |
| C9 | No order history | "No orders yet" | Browse restaurants |
| C10 | No saved addresses | "No saved addresses" | Add an address · Use current location |
| C11 | No favourites | "Nothing saved yet" | Browse restaurants |
| C12 | Vendor has no menu | "This menu is being set up" | Browse nearby · Notify me |
| C13 | Menu category empty | "Nothing in this category yet" | See other categories |
| C14 | No reviews | "No reviews yet" | (none — it is informational) |
| C15 | Taste profile empty | "We don't know your taste yet" | Browse restaurants |
| C16 | No notifications | "Nothing new" | (none) |
| C17 | No promos available | "No offers right now" | Browse restaurants |

### 3.2 Partner app (9)

| # | State | Headline | Actions |
| --- | --- | --- | --- |
| P1 | No orders today | "No orders yet today" | Check device health · Review your menu · See what helps |
| P2 | First ever order pending | "You're live. Waiting for your first order." | Send a test alarm · Review your menu |
| P3 | Menu empty | "Your menu is empty" | Add an item · Import CSV · Ask us to transcribe |
| P4 | Category empty | "Nothing in this category" | Add an item · Delete the category |
| P5 | No invoices yet | "No invoices yet" | How payouts work |
| P6 | No reviews | "No reviews yet" | (none) |
| P7 | No performance data | "Not enough data yet" | What we'll measure |
| P8 | Paused with no return time | "You're paused" | Reopen now · Set a return time |
| P9 | No staff accounts | "Only you have access" | Add a staff login |

### 3.3 Rider app (8)

| # | State | Headline | Actions |
| --- | --- | --- | --- |
| R1 | Online, no offers | "Waiting for orders" | **Live zone info: riders online, orders in the last hour, busiest nearby area** · Check device health |
| R2 | Zone has no demand right now | "Quiet in Sylhet Central" | Suggested busier zone · Take a break |
| R3 | No deliveries today | "No deliveries yet today" | Start your shift |
| R4 | No earnings history | "No earnings yet" | How pay works |
| R5 | No invoices yet | "No invoices yet" | How payouts work |
| R6 | Offline | "You're offline" | Go online |
| R7 | No shift history | "No shifts yet" | Start your first shift |
| R8 | Cash settled, nothing outstanding | "All settled" | (none — it is a success state) |

R1 is the most consequential empty state in the platform. A rider staring at "Waiting for orders"
with no information is a rider who logs off. Showing them *"14 riders online · 9 orders in the
last hour · Zindabazar is busiest right now"* turns dead time into a decision.

### 3.4 Web (4)

| # | State |
| --- | --- |
| W1 | Zone not covered — with an email capture that actually stores the interest and shows on the admin waitlist |
| W2 | No vendors in zone |
| W3 | Search empty |
| W4 | Pre-rendered page for a vendor with no menu — `noindex` until it has one ([`31 §7`](31-seo-prerender-deeplinks.md)) |

### 3.5 Admin panel (6 archetypes, applied to all 60+ tables)

| # | State | Content |
| --- | --- |
| A1 | **Fresh platform** | A genuine getting-started checklist: create a zone → draw its polygon → set pricing → approve the first vendor → approve the first rider → place a test order. Each item links to the screen that does it, and ticks itself when done |
| A2 | No rows matching a filter | "No vendors match these filters" + clear-filters |
| A3 | No rows at all in a domain | Domain-specific: "No invoices yet — they're generated every Monday" |
| A4 | No exceptions | **"All clear"** — a positive state, green, not grey |
| A5 | No data for a chart | "Not enough data yet. This chart needs at least 7 days." — stating the actual requirement |
| A6 | Map with nothing on it | The zone outline with "No active riders or orders right now", not a blank ocean |

A1 is the screen a new operator sees on day one and it is specified as a real feature, not a
placeholder. It is the difference between a usable empty platform and an intimidating one.

---

## 4. Loading, empty, error — three different things

They are routinely conflated and must not be.

| State | Visual | Message | Actions |
| --- | --- | --- | --- |
| **Loading** | Skeleton shapes matching the eventual content. Never a spinner over an empty screen | None | None |
| **Empty** | Illustration + headline + body | Specific and true | At least one |
| **Error** | A distinct illustration, a warning accent | What failed and why, in plain language | Retry + an alternative |
| **Stale** | The real content, dimmed 8%, with a chip | "Updated 4 minutes ago" | Refresh |
| **Offline** | The real content if cached, plus a banner | "You're offline" | Retry |

Rendering a skeleton that matches the real layout, rather than a spinner, is what makes a slow
network feel like a slow load rather than a broken app. Every list has a skeleton matching its row
height and shape.

---

## 5. Copy rules

| Rule | Bad | Good |
| --- | --- | --- |
| Be specific | "No results" | "No restaurants deliver to Shibganj yet" |
| Name the thing | "Empty" | "Your cart is empty" |
| No blame | "You haven't added any items" | "Your cart is empty" |
| No false hope | "Check back soon!" | "We'll notify you when we're live here" — backed by a real notification |
| Explain the requirement | "Not enough data" | "This chart needs at least 7 days of orders" |
| Positive where true | "No exceptions found" | "All clear" |
| Never apologise for normality | "Sorry, nothing here" | "Nothing here yet" |
| One idea per line | A paragraph | ≤ 2 lines of body text |

Every empty state exists in English and Bengali, both reviewed, both tested at 50 widths.

---

## 6. Actions must work

An empty state's action is a promise, and each one is a real, implemented feature:

| Action | Implementation |
| --- | --- |
| **Notify me when we're live** | Stores the location, the contact and the timestamp in `coverage_interest`. Appears in the admin panel as a ranked demand map showing exactly where people want Undal. When a zone activates, every interested person is notified |
| **Suggest a restaurant** | A short form (name, area, phone if known) into `vendor_suggestions`, visible in the onboarding queue as a lead list |
| **Change location** | Opens the location picker with the current pin |
| **Switch to pick-up** | Re-prices the cart with no delivery fee and re-validates |
| **Clear filters** | Clears and re-queries |
| **Remove one filter** | Names the single most restrictive filter and removes just that one |
| **Check device health** | Opens the health screen and re-runs the checks |
| **Send a test alarm** | A real FCM round trip |
| **Take a break** | Starts a break with a duration picker |
| **Suggested busier zone** | Computed from the live forecast surface; it names a real zone with real numbers |
| **How pay works** | An in-app explanation, not a web link |
| **Import CSV** | The real importer with a template download |
| **Ask us to transcribe** | Creates a support task with a 24-hour SLA |

The *"Notify me"* → `coverage_interest` → admin demand map chain is worth highlighting. It turns
the most frustrating moment in the product — a user discovering Undal does not serve them — into
the platform's best expansion signal.

---

## 7. The illustrations

Forty-four bespoke SVGs, drawn in the brand palette, sharing one visual language: soft geometric
shapes, a single accent colour, a light line weight, no faces, no stock-illustration style.

| Property | Value |
| --- | --- |
| Size | 180 dp nominal, scaling to 120 dp below 360 dp width and 220 dp above 840 dp |
| Format | `ImageVector` on Android (no raster), inline SVG on web |
| Weight | ≤ 4 KB each |
| Themes | Two variants, light and dark, from the same geometry with token-driven fills |
| Animation | A 320 ms entry; two (the "waiting for orders" and "all clear" states) have a subtle 4-second ambient loop, disabled under reduce-motion |
| Accessibility | Decorative; `aria-hidden` / `contentDescription = null`. The headline carries the meaning |

---

## 8. Testing

### 8.1 The empty-platform test

The most important test in the suite. On every PR:

1. A fresh CockroachDB schema is created and migrated.
2. **Zero business rows are inserted.**
3. All three Android apps and both web apps are launched against it.
4. **All 283 screens are navigated and rendered.**

Pass criteria: no crash, no blank screen, no spinner that never resolves, no untranslated string,
no "undefined" or "null" rendered anywhere, and every screen either shows content or shows a
registered empty state from the 44.

This single test is what makes "the platform works with zero data" a verified fact.

### 8.2 The rest

| Test | Count |
| --- | --- |
| Each empty state renders correctly | 44 × 2 themes × 2 languages = 176 |
| Each at 50 widths | 2 200 renders |
| Every action is wired and performs its effect | 13 action types, 38 instances |
| Loading / empty / error / stale are visually and semantically distinct | 44 |
| `coverage_interest` is written and surfaced in the admin panel | 6 |
| Notification fires when a zone activates | 4 |
| No empty state uses an error colour token | 1 lint rule |
| No empty state lacks an action, except the 5 allowlisted informational ones | 1 test |
| Copy matches the register exactly | 44 |

---

## 9. The register

Every empty state has an ID (`C1`…`A6`), a screen, a trigger condition, a headline key, a body
key, an action list and a test name, recorded in [`37`](37-feature-register.md). A screen that can
be empty and has no registered state fails CI — enumerated by walking every list and detail
component for an empty branch.

---

## 10. Reading on

Next: [`34-repository-layout.md`](34-repository-layout.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
