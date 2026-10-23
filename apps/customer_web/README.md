# `apps/customer_web` — Undal SEO Customer Web App (Cloudflare Pages)

- **Surface:** React + TypeScript + Vite (`client` + `entry-server` SSG static prerendering, `ADR-0004`)
- **Governing Spec:** `UNDAL-MASTER-GUIDE/19-customer-web-react-seo.md` (`24 pages: w-01..w-24`, `240px → 4K` fluid layout `D-15`)
- **Build Responses:** `Build 23`, `Build 24`
- **SEO Invariant (`WEB-01`):** Raw `curl` without JS receives full rendered HTML + Schema.org `JSON-LD` (`FoodEstablishment` + `Menu` + `BreadcrumbList` + `FAQPage`) + `/sitemap.xml` + `/robots.txt` + `/.well-known/assetlinks.json`.
