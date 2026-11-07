---
trigger: always_on
alwaysApply: true
description: Guardrails for continuous API flows, polling, and outbound fetch on Cloudflare Workers
---

# Cloudflare Worker Edge API Resilience & Polling Guardrails

When authoring or modifying API routes, background polling hooks, or external service integrations running on Cloudflare Workers / OpenNext:

1. **Mandatory AbortController Timeout**:
   - Every outbound `fetch` must be wrapped with an `AbortSignal.timeout(ms)` (or resilient fetch wrapper). Use strict 3s–5s caps for third-party APIs (Steam, Spotify, YouTube). Never allow unbounded fetch calls.

2. **In-Flight Request Coalescing (Promise Deduplication)**:
   - For rapid continuous polling endpoints (e.g. now-playing, media status), coalesce concurrent identical outbound requests into a single in-flight Promise so identical requests share the same external network call.

3. **In-Memory TTL Cache Buffer**:
   - Apply a small in-memory TTL cache (5s–15s) on polling endpoints to absorb rapid bursts without multiplying outbound subrequests against Cloudflare's 50 subrequests limit.

4. **Decoupled Failure Boundaries**:
   - Never let one optional external service (e.g. Spotify 401/timeout) throw an unhandled exception that crashes sibling data (e.g. Steam status). Return partial success with nullified failed sub-objects.

5. **Payload Byte Caps for Edge XML/JSON Parsing**:
   - Always enforce a streaming payload byte cap (e.g. 500KB) when reading external feeds (RSS, XML) before parsing, ensuring CPU time remains well under the 10ms CPU limit.
