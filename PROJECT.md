# Project: dev-knowledge-hub API Flow Hardening & Resilience

## Architecture
- **Runtime**: Next.js 16 (App Router) on Cloudflare Workers via `@opennextjs/cloudflare` 1.16.2 (`wrangler.jsonc`, `nodejs_compat`).
- **Database & Auth**: Supabase SSR / JS client.
- **External Integrations**: Steam Web API & OpenID, Spotify Web API, YouTube Data / Atom feeds, RSS news feeds (45+ sources), Monster Hunter Wilds data.
- **Resource Limits**: Cloudflare Free plan (10ms CPU execution time, 50 subrequests per request, 128MB memory limit).
- **Resilience Layer**: Centralized `resilient-fetch.ts` with strict timeouts, in-flight deduplication (request coalescing), short-term TTL memory cache, exponential backoff with jitter, and max payload size guardrails.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Core Resilient Fetch & Cache Utility | Standardized fetch wrapper with AbortSignal timeout, exponential backoff with jitter, in-flight coalescing, in-memory TTL caching, and payload size guardrails | M1 | Survey |
| 2 | Steam OpenID Callback Timeout | Add strict timeout boundary to Steam OpenID verification fetch | M2 | Survey |
| 3 | Now-Playing Server Caching & Deduplication | Add 10-15s TTL in-flight cache buffer on `/api/media/now-playing` to eliminate subrequest multiplication | M2 | Survey |
| 4 | Now-Playing Fault Isolation | Decouple Spotify and Steam telemetry so Spotify 401 or timeout never crashes Steam telemetry (HTTP 200 with partial/degraded payload) | M2 | Survey |
| 5 | Spotify API Helper Exception Handling | Wrap Spotify search and playback fetch calls in try/catch to prevent unhandled TimeoutError DOMException | M2 | Survey |
| 6 | MH Wilds API Fetch Timeout | Add strict timeout to Monster Hunter Wilds data fetch | M2 | Survey |
| 7 | LiveWidget Client Polling Hardening | Add AbortController signal on client fetch, jittered backoff on errors | M2 | Survey |
| 8 | NewsContainer Redundant RSS Optimization | Eliminate duplicate `getNews()` invocation in `news-container.tsx`, reducing XML parsing load from up to 12 feeds to 5-7 | M3 | Survey |
| 9 | RSS Feed Parsing & Payload Guardrails | Enforce payload byte limits on XML feeds in `news.ts` and optimize regex/entity cleaning to stay strictly within 10ms CPU limit | M3 | Survey |
| 10 | YouTube Playlist XML Import Hardening | Guard XML payload size and handle parsing failures gracefully in `youtube.ts` | M3 | Survey |
| 11 | Automated Resilience Test Suite | Standalone `scripts/test-resilience.mjs` verifying timeouts, fallbacks, request deduplication, and backoff behavior | M4 | Survey / R3 |
| 12 | Project Build, Lint & Typecheck Pass | Zero errors on `tsc --noEmit`, `eslint`, and all test suites | M4 | Survey / R3 |
| 13 | Automated Git Commit & Release Deployment | Commit changes to git and execute OpenNext/Cloudflare deployment build | M5 | Survey / R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Resilient Fetch & Cache Utility | `src/lib/resilience/resilient-fetch.ts` with timeout, coalescing, backoff, and TTL cache | none | DONE |
| M2 | Media, Steam & Now-Playing Flow Hardening | `/api/auth/steam/callback`, `/api/media/now-playing`, `spotify-api.ts`, `mhwilds-api.ts`, `live-widget/page.tsx` | M1 | DONE |
| M3 | RSS Feeds & News Flow Optimization | `news-container.tsx`, `news.ts`, `youtube.ts` payload limits and CPU optimization | M1 | DONE |
| M4 | Automated Resilience Testing & Validation Gate | `scripts/test-resilience.mjs`, `package.json` test scripts, full build/lint/typecheck pass | M2, M3 | DONE (Gate: PASS) |
| M5 | Git Commit & Cloudflare Deployment | Git staging/commit and running deploy script | M4 | IN_PROGRESS (Worker M5: 75403abd-6efd-4d9d-8823-ca8cb3df6078) |

## Code Layout
- `src/lib/resilience/`: Centralized resilient network utilities (`resilient-fetch.ts`)
- `src/app/api/auth/steam/callback/route.ts`: Steam OpenID authentication route
- `src/app/api/media/now-playing/route.ts`: Unified Steam and Spotify telemetry endpoint
- `src/features/media/services/spotify-api.ts`: Spotify Web API service helpers
- `src/features/mh-wilds/services/mhwilds-api.ts`: Monster Hunter Wilds API service
- `src/app/live-widget/page.tsx`: Client-side live widget polling page
- `src/features/news/components/news-container.tsx`: News container component
- `src/features/news/services/news.ts`: RSS news aggregation and XML parsing service
- `src/features/media/services/youtube.ts`: YouTube service and playlist XML parser
- `scripts/test-resilience.mjs`: Automated resilience & timeout test suite

## Interface Contracts
### `resilientFetch<T>(url: string, options?: ResilientFetchOptions): Promise<ResilientFetchResult<T>>`
- Options:
  - `timeoutMs?: number` (default: 4000ms)
  - `retries?: number` (default: 1 on 5xx/network errors, 0 on 4xx)
  - `cacheTtlMs?: number` (default: 0; when > 0, caches parsed/text result in-memory)
  - `coalesceKey?: string` (in-flight request deduplication key)
  - `maxBytes?: number` (payload size limit)
- Returns: `{ ok: boolean, status: number, data: T | null, error?: Error, cached?: boolean }`
