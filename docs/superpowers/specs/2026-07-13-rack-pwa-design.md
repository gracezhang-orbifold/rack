# Rack PWA — Design (addendum to the frontend spec)

**Date:** 2026-07-13
**Status:** Approved pending user review
**Extends:** `docs/superpowers/specs/2026-07-10-rack-selfhosted-design.md` and the frontend plan `docs/superpowers/plans/2026-07-13-frontend.md` (frontend not yet built).

## Context

Rack is used on a phone standing at the equipment cabinet. Making the web app an installable PWA lets people add it to their home screen and launch it full-screen like a native app, and caches the static shell so it starts instantly on repeat visits. Grace chose exactly two goals — **installable app** and **faster repeat loads** — explicitly *not* push notifications and *not* offline data entry (borrowing requires the server and the lock to be online).

## Hard constraint: secure origin

PWA service workers (required for install and asset caching) only run in a secure context — HTTPS or `localhost`. The planned deployment is the office box over plain HTTP, where browsers refuse to register a service worker. Decision: expose the app over HTTPS via a free **Cloudflare Tunnel** at `rack.orbifold.ai → localhost:3000` (auto TLS, also enables off-WiFi access). `orbifold.ai` DNS is pointed at Cloudflare (free); `cloudflared` runs on the office box. Over plain-HTTP LAN the app still works as an ordinary site; installability simply doesn't activate until reached via the HTTPS origin.

## Decisions

| Decision | Choice |
|---|---|
| Goals | Installable (standalone, home-screen icon) + fast repeat loads. No push, no offline borrowing. |
| Tooling | `vite-plugin-pwa` (Workbox), `registerType: "autoUpdate"`. |
| Precache | Built app shell only (JS/CSS/HTML/icons). |
| `/api/*` | **Network-only, never cached** — stale availability/borrow data would be harmful. |
| Offline behavior | Installed app opens from cached shell; data queries fail into the existing "Can't reach Rack" banner. |
| HTTPS | Cloudflare Tunnel `rack.orbifold.ai`. |
| Backend | No application code changes; API already serves `web/dist` (so it serves `sw.js` + manifest). |

## Design

**Manifest** — `name: "Rack"`, `short_name: "Rack"`, `display: "standalone"`, `start_url: "/"`, `theme_color`/`background_color` matching the app (dark `#111827` theme color, light `#f9fafb` background), `icons` at 192×192 and 512×512 plus a 512×512 `maskable` variant. Icons generated from a simple "R" glyph (committed as source SVG + exported PNGs) so nothing external is needed. An `apple-touch-icon` and iOS meta tags (`apple-mobile-web-app-capable`, status-bar style) so Safari's Share → Add to Home Screen also produces a clean standalone launch.

**Service worker (Workbox via vite-plugin-pwa)** — precache all built static assets (the plugin's default `globPatterns` over `dist`). One explicit runtime rule: requests to `/api/` use `NetworkOnly` (no caching). `navigateFallback: "index.html"` so an offline navigation in the installed app loads the SPA shell rather than a browser error page; the shell then renders the reachability banner. `registerType: "autoUpdate"` with `clientsClaim`/`skipWaiting` so a new deploy transparently replaces the old install.

**Registration** — the plugin's virtual `registerSW({ immediate: true })` called once from `main.tsx`. Registration is a no-op on insecure origins, so local dev over plain HTTP is unaffected.

**Backend / deploy** — unchanged application code. `@fastify/static` serves `sw.js` and `manifest.webmanifest` from `dist` before the SPA `notFound` fallback, so both resolve as real files. New deploy steps: build the frontend (already required), then run `cloudflared` on the office box (documented; optionally an opt-in `cloudflared` service in the prod compose reading `CLOUDFLARE_TUNNEL_TOKEN` from `.env`).

## Testing

Service workers don't run in jsdom, so:
- **Unit/build assertion:** after `vite build`, assert `web/dist` contains `manifest.webmanifest`, a service worker file, and the icon PNGs; assert the built `index.html` links the manifest.
- **Playwright E2E:** one added check that the served page exposes `<link rel="manifest">` and the apple-touch-icon. Full install/SW behavior is verified manually (Chrome DevTools → Application → install + Lighthouse PWA check) since headless SW testing is brittle.

## Scope / plan impact

Slots into the existing frontend plan as **one new task** (PWA: plugin config, manifest, icons, registration, build assertion) plus additions to the deploy/README task (Cloudflare Tunnel steps, optional compose service). Does not touch the five screens or the data layer.

Out of scope (unchanged from parent spec): push notifications, offline queueing of borrow/return, background sync.
