<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# 32 — Localisation and Currency

> Undal is built for Bangladesh first. That is not a translation task — it is a typography task, a
> numeral task, a currency-grouping task, a calendar task, and an address-model task. This
> document specifies all of them.

---

## 1. Languages

| Locale | Status | Coverage requirement |
| --- | --- | --- |
| `en` | Source | 100% |
| `bn-BD` | Full | **100% — enforced** |

The `i18n-completeness` CI job fails the build if any key is missing from either locale, if any
of the 187 error codes lacks a message in either, or if any string in either locale is identical
to its key (the classic sign of a forgotten translation).

There is no partial-language state. A platform that falls back to English halfway through a
Bengali sentence is worse than one that is English-only, because it signals that the Bengali
experience is an afterthought.

### 1.1 Adding a language later

The architecture supports it: ICU message format, no concatenated strings, no gendered
assumptions baked into code, `start`/`end` layout properties throughout, and locale-aware number
and date formatting everywhere. Adding Urdu, Hindi or Arabic would require adding RTL styles and a
translation pass, not a refactor.

---

## 2. Typography

Bengali script has needs that Latin-first typography gets wrong by default.

| Property | Latin | Bengali |
| --- | --- | --- |
| Family | Poppins | **Hind Siliguri** |
| Optical size multiplier | 1.00 | **1.07** |
| Line height (body) | 1.45 | **1.55** |
| Letter spacing | −0.01em on headings | **0** — never track Bengali |
| Minimum body size | 14 sp | **15 sp** |
| Font weights shipped | 400, 500, 600, 700 | 400, 500, 600, 700 |

### 2.1 Why 1.07×

Bengali glyphs have a smaller x-height relative to their em box than Latin, so at an identical
point size Bengali text reads smaller and strains the eye. A 7% increase makes the two scripts
appear optically equal. The multiplier is applied automatically by the type system, not by
hand-tuning individual screens:

```kotlin
@Composable
fun undalTextStyle(role: TypeRole): TextStyle {
    val base = UndalType.styles[role]!!
    val isBengali = LocalUndalLocale.current.script == Script.BENGALI
    return if (isBengali) base.copy(
        fontFamily = HindSiliguri,
        fontSize   = base.fontSize * 1.07f,
        lineHeight = base.fontSize * 1.07f * 1.55f,
        letterSpacing = 0.sp,
    ) else base
}
```

### 2.2 Conjuncts and line breaking

Bengali forms conjunct ligatures (যুক্তাক্ষর) that must not be broken. Both platforms are
configured for it: Android uses `LineBreaker.BREAK_STRATEGY_HIGH_QUALITY` with
`HYPHENATION_FREQUENCY_NONE`, and the web uses `word-break: normal; overflow-wrap: break-word;
hyphens: none`. Hyphenation is disabled for Bengali in both, because Bengali does not hyphenate.

### 2.3 Mixed script

A Bengali sentence containing a Latin restaurant name is extremely common. The type system
renders runs in their own family within a single `Text`, using a font chain rather than switching
the whole block, and sets `lang` on the span for correct screen-reader pronunciation.

### 2.4 Self-hosting

Both families are self-hosted as subsetted WOFF2 (web) and bundled TTF (Android). Bengali subsets
are large — the full Hind Siliguri Bengali range is 180 KB — so the web build splits it into
`unicode-range` chunks and loads the Bengali chunk only for Bengali pages. No Google Fonts CDN:
it is a third-party request, a privacy leak, and a CSP exception the platform does not need.

---

## 3. Numerals

Bengali has its own digits (`০১২৩৪৫৬৭৮৯`), and preference for them is genuinely mixed —
many Bangladeshi users read Bengali text comfortably but prefer Latin digits for money and phone
numbers.

| Context | `en` | `bn`, Latin numerals (default) | `bn`, Bengali numerals |
| --- | --- | --- | --- |
| Money | ৳549.00 | ৳549.00 | ৳৫৪৯.০০ |
| Distance | 3.8 km | 3.8 কিমি | ৩.৮ কিমি |
| Time | 2:38 PM | 2:38 PM | ২:৩৮ PM |
| Phone | 01712-345678 | 01712-345678 | **01712-345678** |
| Order code | UND-7K2M9QX4 | UND-7K2M9QX4 | **UND-7K2M9QX4** |
| Rating | 4.6★ | 4.6★ | ৪.৬★ |

Phone numbers and order codes are **never** converted to Bengali numerals, in any setting. They
are identifiers that get typed into other systems, read aloud over the phone, and compared against
an SMS — converting them creates real-world errors.

The setting is a three-way choice in the account screen: *Automatic (Latin) · Bengali digits ·
Latin digits*, defaulting to Latin for a new Bengali user with a single tap to change it.

---

## 4. Currency

### 4.1 The symbol

**৳** (U+09F3, Bengali Rupee Mark), always **before** the amount, separated by a thin space
(U+2009) in text and by a 2 dp gap in layout:

```
  ৳ 549.00        correct
  ৳549.00         acceptable in tight spaces
  549.00 ৳        never
  BDT 549         only in machine-readable contexts (API, CSV export)
  Tk 549          never — it is a transliteration, not the currency
```

Not every font has U+09F3. Both type families are checked for it in CI, and a fallback chain ends
at Noto Sans Bengali, which does.

### 4.2 Grouping

Bangladesh uses the South Asian lakh/crore system, not the Western thousands system:

| Amount | Bangladeshi | Western (wrong here) |
| --- | --- | --- |
| 1 000 | 1,000 | 1,000 |
| 10 000 | 10,000 | 10,000 |
| 100 000 | **1,00,000** | 1̶0̶0̶,̶0̶0̶0̶ |
| 1 000 000 | **10,00,000** | 1̶,̶0̶0̶0̶,̶0̶0̶0̶ |
| 10 000 000 | **1,00,00,000** | 1̶0̶,̶0̶0̶0̶,̶0̶0̶0̶ |

```kotlin
/**
 * Bangladeshi digit grouping: the last three digits, then pairs.
 *
 * ICU's en-IN and bn-BD locales both implement this, but we do not rely on
 * the platform's ICU version — Android 7 ships a different ICU to Android 15,
 * and a payout invoice that groups differently depending on the phone is not
 * acceptable. We implement it ourselves and test it.
 */
fun groupBdt(paisa: Long): String {
    val negative = paisa < 0
    val abs = abs(paisa)
    val taka = abs / 100
    val sub  = abs % 100
    val s = taka.toString()
    val grouped = if (s.length <= 3) s else buildString {
        val head = s.dropLast(3)
        val tail = s.takeLast(3)
        head.reversed().chunked(2).joinTo(this, ",") { it.reversed() }
        reverse()                       // the head was built reversed
        append(',').append(tail)
    }
    return (if (negative) "-" else "") + grouped + "." + sub.toString().padStart(2, '0')
}
```

Tested against 5 000 values including every boundary at 10³, 10⁵, 10⁷ and 10⁹.

### 4.3 Decimals

Always two, always shown, even for a whole amount: `৳320.00`, never `৳320`. Money with a varying
number of decimal places makes columns impossible to scan and invites misreading. Tabular figures
(`font-feature-settings: 'tnum'`) are mandatory anywhere money appears in a list.

### 4.4 Negative amounts

Shown with a leading minus and in the crimson token, never in parentheses:
`−৳180.00`. Parenthesised negatives are an accounting convention that general users misread.

---

## 5. Dates and times

| Context | `en` | `bn` |
| --- | --- | --- |
| Clock | 2:38 PM | 2:38 PM (Bengali numerals if preferred) |
| Today | Today 2:38 PM | আজ ২:৩৮ PM |
| Yesterday | Yesterday 8:12 PM | গতকাল ৮:১২ PM |
| This week | Thu 2:38 PM | বৃহস্পতি ২:৩৮ PM |
| Older | 24 Oct 2026 | ২৪ অক্টোবর ২০২৬ |
| Relative | 12 minutes ago | ১২ মিনিট আগে |
| Duration | 1h 24m | ১ ঘ ২৪ মি |
| Range | 14:36 – 14:41 | ১৪:৩৬ – ১৪:৪১ |

Timezone is **`Asia/Dhaka` (UTC+6)** everywhere, with no daylight saving. All timestamps are
stored in UTC and rendered in Dhaka time. The apps do **not** follow the device timezone: a rider
whose phone is set to the wrong timezone must still see the correct shift times, and an invoice
period boundary is a business fact, not a device setting.

### 5.1 12-hour or 24-hour

Follows the device preference, defaulting to 12-hour, which is the common usage in Bangladesh.
Shift and invoice times in operational contexts (the admin panel, the rider's shift log) use
24-hour regardless, because ambiguity there is expensive.

### 5.2 Calendars

| Calendar | Use |
| --- | --- |
| Gregorian | Everything user-facing |
| **Hijri** | Ramadan and Eid detection for the forecast and for iftar-window ranking boosts. A static table of hijri month starts through 2035 ships with the Brain, because astronomical calculation disagrees with local moon-sighting announcements and the local announcement is what actually governs behaviour |
| Bengali calendar (বঙ্গাব্দ) | Shown as a secondary date on Pohela Boishakh and on invoices where the operator enables it |

The hijri table is editable in the admin panel, because the Bangladeshi moon-sighting committee's
announcement can shift a date by a day and the platform's demand forecast needs to follow the
announcement, not an almanac.

### 5.3 Holidays

A table of Bangladeshi public holidays and observances through 2035, used by the demand forecast
and by vendor hour suggestions: Pohela Boishakh, Shaheed Dibosh, Independence Day, Eid-ul-Fitr
(3 days), Eid-ul-Adha (3 days), Durga Puja, Victory Day, Christmas, and the Ramadan window.

---

## 6. Addresses

Bangladeshi addresses do not fit a Western address model, and forcing them into one produces
undeliverable orders.

| Field | Required | Example |
| --- | --- | --- |
| House / building | Yes | House 42, Bashundhara Villa |
| Floor / flat | Optional but prompted | 3rd floor, Flat B2 |
| Road / lane | Yes | Road 7, Lane 3 |
| Block / sector | Optional | Block C |
| **Area / mohalla** | **Yes** | Shibganj |
| City | Yes | Sylhet |
| Postcode | Optional | 3100 |
| **Landmark** | **Yes** | Beside the blue mosque, opposite Bata showroom |
| Delivery note | Optional | Gate is locked after 10pm, call first |

**The landmark field is mandatory.** In most of Bangladesh a landmark is how a courier actually
finds a door; the street address is frequently approximate and house numbering is often
non-sequential. Making it optional would be designing for a country that is not this one.

The pin on the map is the authoritative coordinate; the text is how a human finds the right door
once they are at the pin.

### 6.1 Rendering

```
  House 42, Flat B2 (3rd floor)
  Road 7, Shibganj
  Sylhet 3100
  📍 Beside the blue mosque
```

Address lines are assembled by a formatter, never by string concatenation at a call site, so an
empty optional field never leaves a stray comma or a blank line.

---

## 7. Names

| Rule | Reason |
| --- | --- |
| One `full_name` field, not first/last | Bangladeshi naming conventions do not split cleanly, and "last name" is often a family or honorific element |
| No title field | Not useful, and a source of needless friction |
| Minimum 2 characters, maximum 80 | |
| Unicode-safe | Bengali, Latin and mixed, with NFC normalisation |
| Display | As entered. Never auto-capitalised, never reordered |
| Sorting | Locale-aware collation; Bengali collation differs from byte order |
| Initials | First grapheme cluster of up to two whitespace-separated parts — **grapheme cluster**, not character, or a Bengali conjunct is sliced in half |

That last point is a real bug in a great many apps: taking `name[0]` of a Bengali name can produce
an orphaned vowel sign. The avatar component uses `BreakIterator` on Android and `Intl.Segmenter`
on the web.

---

## 8. Phone numbers

| Property | Value |
| --- | --- |
| Country | `+880` only; the picker exists but is fixed |
| Format | `01XXX-XXXXXX` for display, `+8801XXXXXXXXX` for storage |
| Operators | `013` Grameenphone · `014` Banglalink · `015` Teletalk · `016` Airtel · `017` Grameenphone · `018` Robi · `019` Banglalink |
| Validation | Prefix must be in the list; total 11 digits after the leading zero is stripped |
| Input | Auto-formats while typing; accepts `+880`, `880`, `0` and bare forms and normalises them |
| Display | Grouped for readability; Latin digits always |

---

## 9. Pluralisation and message format

Every string with a count uses ICU plural rules. Bengali has two plural categories (`one`,
`other`), English has two — but the forms differ and the pattern must not be hand-rolled:

```
order.item_count = {count, plural,
    one {# item}
    other {# items}}

order.item_count:bn = {count, plural,
    one {# টি আইটেম}
    other {# টি আইটেম}}
```

**String concatenation is banned by lint.** `"You have " + n + " orders"` is untranslatable
because word order differs between languages. Every user-visible string is a message-format
template with named placeholders.

---

## 10. Units

| Quantity | Unit | Format |
| --- | --- | --- |
| Distance (< 1 km) | metres | `420 m` / `৪২০ মি` |
| Distance (≥ 1 km) | kilometres, 1 decimal | `3.8 km` / `৩.৮ কিমি` |
| Duration (< 1 h) | minutes | `18 min` / `১৮ মিনিট` |
| Duration (≥ 1 h) | hours + minutes | `1h 24m` / `১ ঘ ২৪ মি` |
| Weight | grams / kilograms | `250 g`, `1.5 kg` |
| Temperature | Celsius | `32°C` |
| Speed | km/h | `34 km/h` |

No imperial units anywhere, in any locale.

---

## 11. Content guidelines

| Guideline | Example |
| --- | --- |
| Address the user as *you* / *আপনি* | Formal `আপনি`, never informal `তুমি` |
| Say what happened and what to do | *"The restaurant's device was unreachable. Your order was cancelled and you've been given ৳50 credit."* |
| No blame, no jargon, no error codes alone | An error code may appear as a small reference under a human sentence |
| Sentence case for everything | Not Title Case, not ALL CAPS, except the single-word slide labels |
| Numbers as digits | *"3 items"*, not *"three items"* |
| Never "Something went wrong" | Banned by lint |
| Bengali is written, not transliterated English | *"অর্ডার দিন"*, never *"Order din"* |

---

## 12. Translation workflow

| Step | Mechanism |
| --- | --- |
| Extraction | Lingui (web) and a Gradle task (Android) extract to a shared catalogue |
| Format | ICU MessageFormat in JSON, one file per locale |
| Review | Bengali strings are reviewed by a native speaker; the PR template requires a reviewer name for any new `bn` string |
| Context | Every key carries a developer comment describing where it appears and any length constraint |
| Length | Bengali is typically 10–20% longer than English; the responsive matrix tests every screen in both languages precisely to catch overflow |
| Pseudolocale | An `en-XA` pseudolocale that expands strings by 35% and adds accents runs in the screenshot matrix, catching hard-coded strings and fragile layouts before translation exists |

---

## 13. Testing

| Test | Count |
| --- | --- |
| `i18n-completeness` | 1 CI job: every key, both locales, all 184 error codes |
| No concatenated user strings | 1 lint rule |
| Lakh/crore grouping | 5 000 values |
| Currency rendering, all contexts | 48 |
| Numeral conversion, including the never-convert list | 24 |
| Date and relative-time formatting | 96 |
| Hijri table correctness through 2035 | 1 |
| Address formatter, every field combination | 64 |
| Phone normalisation and validation | 120 |
| Name initials with Bengali conjuncts | 40 |
| Plural rules, both locales | 32 |
| Pseudolocale screenshot pass | Every screen |
| Bengali screenshot pass | Every screen, 50 widths |
| Font fallback for U+09F3 | 1 |
| Line breaking does not split conjuncts | 18 |

---

## 14. Reading on

Next: [`33-empty-state-doctrine.md`](33-empty-state-doctrine.md).

---

*Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.*
