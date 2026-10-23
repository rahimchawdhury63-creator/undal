# Undal Sound Assets

| File | Use | Spec |
|---|---|---|
| `undal_order_alert_loop.wav` | Vendor new-order + rider offer alarm (file `07`) | 8 s seamless loop, 44.1 kHz mono 16-bit, two-tone 1320/880 Hz urgency pattern + ticks, normalised ≈ −1 dBFS. Convert to `.ogg` (q6) or `.mp3` (192 kbps) into `res/raw/` at app build; loop with `MediaPlayer.isLooping=true` on **STREAM_ALARM**. |

**Sibling sounds the builder synthesises with the same recipe** (script them in `infra/scripts/make_sounds.py`, same
sample-rate/normalisation, verify on device speakers): `undal_pickup_chime` (E5→A5→E6 triad, 0.8 s), `undal_tick_tick`
(cash-gate reminder: 1 kHz ticks ×4 / 2 s, loops while gate open in-app), `undal_success` (0.3 s blip), `undal_chat_pop`
(0.15 s). Alarm variants offered in Partner/Rider settings must all pass the kitchen-noise audibility test (file `26`):
audible at 3 m over 70 dB ambient on a Tecno/Xiaomi reference device at forced-max alarm volume. Never ship a
copyrighted ringtone; all Undal sounds are original synth tones (public-domain-safe by construction).
