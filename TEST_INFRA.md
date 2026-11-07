# E2E Test Infra: dev-knowledge-hub API Flow Hardening

## Test Philosophy
- Opaque-box and resilience-driven. Verify timeout handling, error recovery, caching, and resource compliance.
- Zero extra heavy dependencies: runs directly via Node.js test harness using `assert` module, matching the project's existing test architecture (`scripts/test-qa-flows.mjs`).

## Feature Inventory & Test Coverage
| # | Feature | Source (Requirement) | Tier 1 (Unit/Feature) | Tier 2 (Boundary/Timeout) | Tier 3 (Cross-Feature) | Tier 4 (Workload/Polling) |
|---|---------|---------------------|:---------------------:|:------------------------:|:----------------------:|:------------------------:|
| 1 | Resilient Fetch Timeout | R1, R2 | ✓ | ✓ | ✓ | ✓ |
| 2 | In-Flight Coalescing & Caching | R1, R2 | ✓ | ✓ | ✓ | ✓ |
| 3 | Steam Callback Timeout | R1 | ✓ | ✓ | - | - |
| 4 | Now-Playing Caching & Deduplication | R1, R2 | ✓ | ✓ | ✓ | ✓ |
| 5 | Now-Playing Fault Isolation (Spotify failure) | R1, R2 | ✓ | ✓ | ✓ | - |
| 6 | Spotify API Timeout & Error Trapping | R1, R2 | ✓ | ✓ | - | - |
| 7 | News Feed CPU & Payload Guardrail | R1, R2 | ✓ | ✓ | - | ✓ |
| 8 | Live Widget Polling & Backoff | R1, R2 | ✓ | ✓ | ✓ | ✓ |

## Test Architecture
- Test Runner: `scripts/test-resilience.mjs`
- Invocation: `node scripts/test-resilience.mjs` or `yarn test:resilience` (and integrated into `yarn test:all`)
- Pass/Fail Semantics: Process exits with code 0 on all tests passing, non-zero code on any failure.
- Mocking: Uses Node.js HTTP local mock servers to simulate fast responses, delayed hangs, network drops, 401s, 429s, and 500s.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | High-frequency client polling storm (simulating multiple OBS overlays requesting now-playing simultaneously) | Now-Playing Caching, In-flight Coalescing, Subrequest Reduction | High |
| 2 | Upstream service degradation (Steam/Spotify hanging or returning 504 Gateway Timeout) | Timeout Enforcement, Graceful Fallback (Status 200 degraded telemetry), No Worker Crash | High |
| 3 | Oversized RSS feeds and slow feed servers | Payload Cap, Timeout Abort, Fast-fail without CPU spike | Medium |
| 4 | Spotify token revocation / 401 error during active game session | Decoupled telemetry: Steam telemetry preserved, Spotify marked unavailable | Medium |

## Coverage Thresholds
- Tier 1: Functional tests for resilient-fetch options, timeout defaults, cache hits/misses.
- Tier 2: Boundary tests (0ms timeout, oversized payloads, non-JSON responses).
- Tier 3: Pairwise combinations (caching + retries, timeout + fallback).
- Tier 4: Realistic workload simulations with simulated mock servers.
