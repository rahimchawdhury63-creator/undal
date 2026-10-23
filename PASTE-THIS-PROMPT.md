# 👉 PASTE THIS PROMPT to build Undal

Copy **everything inside the box below** and paste it to the AI agent (Arena Agent Mode with this repo connected).
Then keep replying **`continue`** after each response. That's it — the AI does the rest, guided by the full
blueprint in [`UNDAL-MASTER-GUIDE/`](UNDAL-MASTER-GUIDE/00-START-HERE.md).

---

```
You are building UNDAL — Food Delivery & Pickup (multi-vendor, COD-only, food-only, 100% free stack:
3 Flutter Android apps + React website + Super Admin, Supabase + Firebase RTDB/FCM + 3 Cloudflare
Workers + ImgBB + OpenStreetMap). This repo already contains your complete blueprint. Follow it exactly:

1) Read UNDAL-MASTER-GUIDE/00-START-HERE.md, then files 01–28 and appendices A–L in order.
   The decision log in file 01 (D-01…D-24) is law — never deviate silently; raise an ADR instead.
2) Execute file 27: first give me PLAN RESPONSE 1, then PLAN RESPONSE 2 — open and analyse EVERY
   image in reference-images/ (170 files), extending the analysis in docs/understanding/.
   Then build in BUILD RESPONSES 1–30 in the tabled order. Give maximum output each response,
   then STOP and wait for my "continue".
3) Non-negotiables: no placeholders/demo data/dead buttons; money in integer poisha; data-only FCM
   alarm engine (file 07); secrets only in GitHub/Worker secret stores (never write any key value);
   files ≤500 lines, fully documented; tests + CI evidence in every response; all deploys and signed
   APK/AAB builds via GitHub Actions — I work from an Android tablet, never ask me to run local commands.
4) Your full governing prompt is versioned at UNDAL-MASTER-GUIDE/28-master-build-prompt.md — obey it.

Begin with Plan Response 1 now.
```

---

### Before you paste (founder, 3 things)

1. 🔑 **Rotate your ImgBB API key** (the old one was shared in plain text — treat it as leaked). New key → GitHub Secret only. Steps: `UNDAL-MASTER-GUIDE/env/github-actions-secrets.example.md`.
2. 📱 Create the free accounts (Supabase, Firebase, Cloudflare) using `UNDAL-MASTER-GUIDE/24-github-actions-cicd-secrets.md` §2 — all from your tablet browser.
3. 💬 When the AI asks questions in Plan Responses, answer briefly; for everything else just type `continue`.
