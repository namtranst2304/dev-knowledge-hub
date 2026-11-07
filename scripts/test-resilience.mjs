/**
 * Automated Resilience, Timeout, Caching & Concurrency Test Runner
 * Stack: Next.js on Cloudflare Workers + Resilient Fetch Architecture
 *
 * Verifies R1 & R2 requirements across Tiers 1-4:
 * Tier 1: Functional resilient fetch operations, timeouts, and options handling
 * Tier 2: Boundary, corner cases, zero/1ms timeout aborts, payload limits, and error codes
 * Tier 3: In-flight request coalescing / deduplication concurrency
 * Tier 4: Cache TTL expiration, high-frequency polling storm, and resilient fallback isolation
 */

import assert from 'node:assert';
import http from 'node:http';
import {
    resilientFetch,
    clearResilientFetchCache,
    getResilientFetchCacheSize
} from '../src/lib/resilience/resilient-fetch.ts';

console.log('====================================================');
console.log('🛡️  RUNNING AUTOMATED RESILIENCE & CACHING TEST SUITE');
console.log('====================================================\n');

let passedTests = 0;
let failedTests = 0;

async function runTest(id, title, testFn) {
    try {
        await testFn();
        console.log(`✅ [PASS] ${id}: ${title}`);
        passedTests++;
    } catch (err) {
        console.error(`❌ [FAIL] ${id}: ${title}`);
        console.error(`   Error: ${err.message}\n${err.stack}\n`);
        failedTests++;
    }
}

/**
 * Creates a lightweight local HTTP mock server on an ephemeral OS-assigned port.
 */
function createMockServer(handler) {
    const server = http.createServer(handler);
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            const baseUrl = `http://127.0.0.1:${port}`;
            resolve({
                server,
                baseUrl,
                close: () => new Promise(res => server.close(res))
            });
        });
        server.on('error', reject);
    });
}

// Helper to calculate jittered progressive exponential backoff (as implemented for Live Widget)
function calculateWidgetBackoff(consecutiveFailures, baseDelayMs = 30000, maxDelayMs = 300000) {
    if (consecutiveFailures <= 0) return baseDelayMs;
    const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, consecutiveFailures));
    // ±10% jitter
    const jitter = (Math.random() * 0.2 - 0.1) * exponential;
    return Math.max(baseDelayMs, Math.round(exponential + jitter));
}

// Unified telemetry aggregator simulating /api/media/now-playing fault isolation
async function simulateNowPlayingTelemetry(steamUrl, spotifyUrl) {
    const [steamRes, spotifyRes] = await Promise.all([
        resilientFetch(steamUrl, { timeoutMs: 1500, retries: 0 }),
        resilientFetch(spotifyUrl, { timeoutMs: 1500, retries: 0 })
    ]);

    // Fault isolation: Spotify 401 or timeout never crashes Steam telemetry
    const spotifyAvailable = spotifyRes.ok && spotifyRes.data !== null;

    return {
        status: 200,
        data: {
            steam: steamRes.ok ? steamRes.data : null,
            spotify: spotifyAvailable ? spotifyRes.data : null,
            spotifyStatus: spotifyAvailable ? 'active' : (spotifyRes.status === 401 ? 'unauthorized' : 'unavailable')
        }
    };
}

async function runAllTests() {
    // ==========================================
    // TIER 1: RESILIENT FETCH FUNCTIONAL TESTS
    // ==========================================
    console.log('--- Tier 1: Core Functional & Options Tests ---');

    // TC_T1_01: JSON response parsing & success status
    await runTest('TC_T1_01', 'resilientFetch parses JSON response and returns ok: true', async () => {
        const mock = await createMockServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'steam', timestamp: 123456789 }));
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/data`, { timeoutMs: 2000 });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.status, 200);
            assert.strictEqual(result.data.status, 'ok');
            assert.strictEqual(result.data.service, 'steam');
            assert.strictEqual(result.cached, false);
        } finally {
            await mock.close();
        }
    });

    // TC_T1_02: XML / Text response parsing
    await runTest('TC_T1_02', 'resilientFetch handles non-JSON XML/text responses correctly', async () => {
        const mock = await createMockServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
            res.end('<rss version="2.0"><channel><title>Gaming News</title></channel></rss>');
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/rss`, { timeoutMs: 2000, responseType: 'text' });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.status, 200);
            assert.ok(typeof result.data === 'string');
            assert.ok(result.data.includes('<title>Gaming News</title>'));
        } finally {
            await mock.close();
        }
    });

    // TC_T1_03: Headers forwarding
    await runTest('TC_T1_03', 'resilientFetch passes custom headers including Authorization to upstream', async () => {
        let receivedAuthHeader = null;
        let receivedCustomHeader = null;

        const mock = await createMockServer((req, res) => {
            receivedAuthHeader = req.headers['authorization'];
            receivedCustomHeader = req.headers['x-client-id'];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ authenticated: true }));
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/auth-test`, {
                headers: {
                    Authorization: 'Bearer spotify-test-token-abc',
                    'X-Client-ID': 'DevKnowledgeHub/1.0'
                }
            });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(receivedAuthHeader, 'Bearer spotify-test-token-abc');
            assert.strictEqual(receivedCustomHeader, 'DevKnowledgeHub/1.0');
        } finally {
            await mock.close();
        }
    });

    // TC_T1_04: POST request with body
    await runTest('TC_T1_04', 'resilientFetch supports POST requests and payload transmission', async () => {
        let receivedMethod = null;
        let receivedBody = '';

        const mock = await createMockServer((req, res) => {
            receivedMethod = req.method;
            req.on('data', chunk => { receivedBody += chunk; });
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ echoed: JSON.parse(receivedBody) }));
            });
        });
        try {
            const payload = { action: 'sync_mood', game: 'Monster Hunter Wilds' };
            const result = await resilientFetch(`${mock.baseUrl}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(receivedMethod, 'POST');
            assert.deepStrictEqual(result.data.echoed, payload);
        } finally {
            await mock.close();
        }
    });

    // TC_T1_05: Timeout enforcement on slow upstream
    await runTest('TC_T1_05', 'resilientFetch enforces timeout and aborts when response exceeds timeoutMs', async () => {
        const mock = await createMockServer((req, res) => {
            // Delay for 300ms, exceeding timeoutMs of 80ms
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ slow: true }));
                }
            }, 300);
        });
        try {
            const startTime = Date.now();
            const result = await resilientFetch(`${mock.baseUrl}/slow`, {
                timeoutMs: 80,
                retries: 0
            });
            const duration = Date.now() - startTime;

            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 504);
            assert.strictEqual(result.data, null);
            assert.ok(result.error instanceof Error);
            assert.ok(duration < 250, `Expected abort before 250ms, took ${duration}ms`);
        } finally {
            await mock.close();
        }
    });

    // ==========================================
    // TIER 2: BOUNDARY & CORNER TESTS
    // ==========================================
    console.log('\n--- Tier 2: Boundary, Corner & Error Handling Tests ---');

    // TC_T2_01: Immediate 1ms timeout abort
    await runTest('TC_T2_01', 'Boundary: Immediate 1ms timeout aborts fast without hanging caller', async () => {
        const mock = await createMockServer((req, res) => {
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.writeHead(200);
                    res.end('done');
                }
            }, 100);
        });
        try {
            const start = Date.now();
            const result = await resilientFetch(`${mock.baseUrl}/immediate-timeout`, {
                timeoutMs: 1,
                retries: 0
            });
            const elapsed = Date.now() - start;

            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 504);
            assert.ok(elapsed < 50, `Immediate timeout took too long: ${elapsed}ms`);
        } finally {
            await mock.close();
        }
    });

    // TC_T2_02: Mock server hung connection (no response headers/body)
    await runTest('TC_T2_02', 'Boundary: Hang simulation — infinite delay terminated cleanly by timeout', async () => {
        const mock = await createMockServer((_req, _res) => {
            // Intentionally never respond (simulating stalled upstream socket)
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/hung-upstream`, {
                timeoutMs: 100,
                retries: 0
            });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 504);
            assert.ok(result.error.message.includes('timed out'));
        } finally {
            await mock.close();
        }
    });

    // TC_T2_03: Payload size limit protection (maxBytes)
    await runTest('TC_T2_03', 'Boundary: Payload guardrail rejects responses exceeding maxBytes with HTTP 413', async () => {
        const largePayload = Buffer.alloc(32 * 1024, 'a').toString(); // 32KB payload
        const mock = await createMockServer((req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/plain',
                'Content-Length': String(Buffer.byteLength(largePayload))
            });
            res.end(largePayload);
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/oversized`, {
                maxBytes: 1024, // 1KB limit
                retries: 0
            });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 413);
            assert.strictEqual(result.data, null);
            assert.ok(result.error.message.includes('maximum allowed size'));
        } finally {
            await mock.close();
        }
    });

    // TC_T2_04: HTTP 500 error handling & retry behavior
    await runTest('TC_T2_04', 'Error: HTTP 500 triggers retry and handles gracefully without unhandled exception', async () => {
        let requestCount = 0;
        const mock = await createMockServer((req, res) => {
            requestCount++;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/error-500`, {
                retries: 1,
                backoffBaseMs: 10,
                backoffMaxMs: 30
            });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 500);
            assert.strictEqual(requestCount, 2); // 1 initial + 1 retry
        } finally {
            await mock.close();
        }
    });

    // TC_T2_05: HTTP 503 Service Unavailable handling
    await runTest('TC_T2_05', 'Error: HTTP 503 captured safely without crashing process', async () => {
        const mock = await createMockServer((req, res) => {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service Unavailable' }));
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/error-503`, { retries: 0 });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 503);
            assert.ok(result.error.message.includes('503'));
        } finally {
            await mock.close();
        }
    });

    // TC_T2_06: HTTP 429 Rate Limit error handling
    await runTest('TC_T2_06', 'Error: HTTP 429 Rate Limit captured gracefully', async () => {
        const mock = await createMockServer((req, res) => {
            res.writeHead(429, {
                'Content-Type': 'application/json',
                'Retry-After': '1'
            });
            res.end(JSON.stringify({ error: 'Too Many Requests' }));
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/error-429`, { retries: 0 });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 429);
        } finally {
            await mock.close();
        }
    });

    // TC_T2_07: Non-retryable HTTP 401 Unauthorized
    await runTest('TC_T2_07', 'Error: HTTP 401 is non-retryable and returns immediately', async () => {
        let requestCount = 0;
        const mock = await createMockServer((req, res) => {
            requestCount++;
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized token' }));
        });
        try {
            const result = await resilientFetch(`${mock.baseUrl}/unauthorized`, { retries: 2 });
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 401);
            assert.strictEqual(requestCount, 1); // 401 must NOT be retried
        } finally {
            await mock.close();
        }
    });

    // ==========================================
    // TIER 3: IN-FLIGHT REQUEST COALESCING
    // ==========================================
    console.log('\n--- Tier 3: In-Flight Request Coalescing / Deduplication Tests ---');

    // TC_T3_01: Concurrent duplicate requests coalesced into single network call
    await runTest('TC_T3_01', 'Coalescing: 5 concurrent requests collapse into 1 network subrequest', async () => {
        let serverHitCount = 0;
        const mock = await createMockServer((req, res) => {
            serverHitCount++;
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ hit: serverHitCount, data: 'telemetry_payload' }));
            }, 80);
        });
        try {
            clearResilientFetchCache();
            const targetUrl = `${mock.baseUrl}/telemetry-coalesce`;

            // Fire 5 concurrent requests sharing the same coalesceKey / URL
            const promises = [
                resilientFetch(targetUrl, { coalesceKey: 'coalesce_key_test' }),
                resilientFetch(targetUrl, { coalesceKey: 'coalesce_key_test' }),
                resilientFetch(targetUrl, { coalesceKey: 'coalesce_key_test' }),
                resilientFetch(targetUrl, { coalesceKey: 'coalesce_key_test' }),
                resilientFetch(targetUrl, { coalesceKey: 'coalesce_key_test' })
            ];

            const results = await Promise.all(promises);

            // Verify all 5 received identical successful data
            assert.strictEqual(results.length, 5);
            for (const r of results) {
                assert.strictEqual(r.ok, true);
                assert.strictEqual(r.data.data, 'telemetry_payload');
            }

            // CRITICAL: Exactly 1 subrequest hit the upstream server!
            assert.strictEqual(serverHitCount, 1, `Expected 1 upstream request, but got ${serverHitCount}`);
        } finally {
            await mock.close();
        }
    });

    // TC_T3_02: Sequential request after in-flight completion executes fresh call
    await runTest('TC_T3_02', 'Coalescing: In-flight map is purged after completion allowing fresh calls', async () => {
        let serverHitCount = 0;
        const mock = await createMockServer((req, res) => {
            serverHitCount++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ seq: serverHitCount }));
        });
        try {
            clearResilientFetchCache();
            const url = `${mock.baseUrl}/sequential-test`;

            const first = await resilientFetch(url, { coalesceKey: 'seq_key', cacheTtlMs: 0 });
            assert.strictEqual(first.data.seq, 1);
            assert.strictEqual(serverHitCount, 1);

            const second = await resilientFetch(url, { coalesceKey: 'seq_key', cacheTtlMs: 0 });
            assert.strictEqual(second.data.seq, 2);
            assert.strictEqual(serverHitCount, 2);
        } finally {
            await mock.close();
        }
    });

    // TC_T3_03: Distinct coalesce keys do not coalesce
    await runTest('TC_T3_03', 'Coalescing: Different coalesce keys dispatch separate network requests', async () => {
        let serverHitCount = 0;
        const mock = await createMockServer((req, res) => {
            serverHitCount++;
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ count: serverHitCount }));
            }, 40);
        });
        try {
            clearResilientFetchCache();
            const url = `${mock.baseUrl}/distinct-keys`;

            const [resA, resB] = await Promise.all([
                resilientFetch(url, { coalesceKey: 'key_alpha' }),
                resilientFetch(url, { coalesceKey: 'key_beta' })
            ]);

            assert.strictEqual(resA.ok, true);
            assert.strictEqual(resB.ok, true);
            assert.strictEqual(serverHitCount, 2, 'Distinct keys should produce 2 independent requests');
        } finally {
            await mock.close();
        }
    });

    // ==========================================
    // TIER 4: CACHE TTL & WORKLOAD SIMULATION
    // ==========================================
    console.log('\n--- Tier 4: Cache TTL & Real-World Workload Simulations ---');

    // TC_T4_01: Cache hit within TTL returns cached: true without upstream request
    await runTest('TC_T4_01', 'Cache: Request within TTL returns cached payload without server hit', async () => {
        let hitCount = 0;
        const mock = await createMockServer((req, res) => {
            hitCount++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ value: 'timestamp_' + Date.now() }));
        });
        try {
            clearResilientFetchCache();
            const url = `${mock.baseUrl}/cache-ttl-test`;

            // First call: fresh fetch
            const first = await resilientFetch(url, { cacheTtlMs: 250 });
            assert.strictEqual(first.ok, true);
            assert.strictEqual(first.cached, false);
            assert.strictEqual(hitCount, 1);

            // Second call within TTL: cache hit
            const second = await resilientFetch(url, { cacheTtlMs: 250 });
            assert.strictEqual(second.ok, true);
            assert.strictEqual(second.cached, true);
            assert.strictEqual(second.data.value, first.data.value);
            assert.strictEqual(hitCount, 1); // No new server request!
            assert.ok(getResilientFetchCacheSize() > 0);
        } finally {
            await mock.close();
        }
    });

    // TC_T4_02: Cache expiry triggers fresh upstream fetch
    await runTest('TC_T4_02', 'Cache: Expired cache entry triggers fresh upstream fetch and updates cache', async () => {
        let hitCount = 0;
        const mock = await createMockServer((req, res) => {
            hitCount++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ generation: hitCount }));
        });
        try {
            clearResilientFetchCache();
            const url = `${mock.baseUrl}/cache-expiry-test`;

            const first = await resilientFetch(url, { cacheTtlMs: 80 });
            assert.strictEqual(first.data.generation, 1);
            assert.strictEqual(first.cached, false);

            // Wait 120ms to ensure cache expiry (> 80ms)
            await new Promise(r => setTimeout(r, 120));

            const second = await resilientFetch(url, { cacheTtlMs: 80 });
            assert.strictEqual(second.data.generation, 2);
            assert.strictEqual(second.cached, false);
            assert.strictEqual(hitCount, 2);
        } finally {
            await mock.close();
        }
    });

    // TC_T4_03: Polling storm simulation (15 simultaneous OBS overlays)
    await runTest('TC_T4_03', 'Workload: OBS overlay polling storm coalesces into single subrequest', async () => {
        let upstreamFetches = 0;
        const mock = await createMockServer((req, res) => {
            upstreamFetches++;
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    game: 'Monster Hunter Wilds',
                    activePlayers: 48500,
                    track: 'Proof of a Hero'
                }));
            }, 60);
        });
        try {
            clearResilientFetchCache();
            const nowPlayingUrl = `${mock.baseUrl}/api/media/now-playing`;

            // 15 simultaneous clients requesting now-playing telemetry
            const clients = Array.from({ length: 15 }, () =>
                resilientFetch(nowPlayingUrl, {
                    cacheTtlMs: 10000,
                    coalesceKey: 'now-playing-global'
                })
            );

            const responses = await Promise.all(clients);

            assert.strictEqual(responses.length, 15);
            for (const resp of responses) {
                assert.strictEqual(resp.ok, true);
                assert.strictEqual(resp.data.game, 'Monster Hunter Wilds');
            }

            // High concurrency collapsed to 1 single network call
            assert.strictEqual(upstreamFetches, 1, `Observed ${upstreamFetches} fetches, expected 1`);
        } finally {
            await mock.close();
        }
    });

    // TC_T4_04: Spotify fault isolation simulation
    await runTest('TC_T4_04', 'Workload: Spotify 401 error does not crash Steam telemetry (Fault Isolation)', async () => {
        // Steam service mock: Healthy (200 OK)
        const steamMock = await createMockServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                personaname: 'NamDev',
                gameextrainfo: 'Monster Hunter Wilds',
                gameid: '2246340'
            }));
        });

        // Spotify service mock: Token revoked/expired (401 Unauthorized)
        const spotifyMock = await createMockServer((req, res) => {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { status: 401, message: 'The access token expired' } }));
        });

        try {
            const telemetry = await simulateNowPlayingTelemetry(
                `${steamMock.baseUrl}/steam/player`,
                `${spotifyMock.baseUrl}/spotify/current-track`
            );

            // Verify fault isolation:
            // Whole endpoint returns HTTP 200, Steam data is preserved, Spotify is marked unauthorized
            assert.strictEqual(telemetry.status, 200);
            assert.ok(telemetry.data.steam !== null);
            assert.strictEqual(telemetry.data.steam.personaname, 'NamDev');
            assert.strictEqual(telemetry.data.steam.gameextrainfo, 'Monster Hunter Wilds');
            assert.strictEqual(telemetry.data.spotify, null);
            assert.strictEqual(telemetry.data.spotifyStatus, 'unauthorized');
        } finally {
            await steamMock.close();
            await spotifyMock.close();
        }
    });

    // TC_T4_05: News RSS payload cap guardrail simulation
    await runTest('TC_T4_05', 'Workload: Oversized 2MB RSS feed aborted early to protect Worker 10ms CPU limit', async () => {
        // Generate 2MB dummy XML news feed
        const itemChunk = '<item><title>Gaming news update</title><description>Long article text content...</description></item>\n';
        const repeatedItems = itemChunk.repeat(20000); // ~2MB
        const feedPayload = `<?xml version="1.0"?><rss><channel><title>Huge Feed</title>${repeatedItems}</channel></rss>`;

        const mock = await createMockServer((req, res) => {
            res.writeHead(200, {
                'Content-Type': 'application/xml',
                'Content-Length': String(Buffer.byteLength(feedPayload))
            });
            res.end(feedPayload);
        });

        try {
            const result = await resilientFetch(`${mock.baseUrl}/large-feed.xml`, {
                maxBytes: 500 * 1024, // 500KB guardrail for RSS feeds
                retries: 0
            });

            // Guardrail must reject with HTTP 413
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.status, 413);
            assert.strictEqual(result.data, null);
            assert.ok(result.error.message.includes('maximum allowed size'));
        } finally {
            await mock.close();
        }
    });

    // TC_T4_06: Live Widget client polling jittered exponential backoff
    await runTest('TC_T4_06', 'Workload: Live widget calculates progressive jittered backoff on errors', async () => {
        // 0 failures -> base 30s
        const delay0 = calculateWidgetBackoff(0);
        assert.strictEqual(delay0, 30000);

        // 1 failure -> ~60s ± 10% (between 54,000 and 66,000ms)
        const delay1 = calculateWidgetBackoff(1);
        assert.ok(delay1 >= 54000 && delay1 <= 66000, `Delay1 (${delay1}) out of range [54000, 66000]`);

        // 2 failures -> ~120s ± 10% (between 108,000 and 132,000ms)
        const delay2 = calculateWidgetBackoff(2);
        assert.ok(delay2 >= 108000 && delay2 <= 132000, `Delay2 (${delay2}) out of range [108000, 132000]`);

        // 3 failures -> ~240s ± 10% (between 216,000 and 264,000ms)
        const delay3 = calculateWidgetBackoff(3);
        assert.ok(delay3 >= 216000 && delay3 <= 264000, `Delay3 (${delay3}) out of range [216000, 264000]`);

        // 4 failures -> capped at 300s ± 10% (between 270,000 and 330,000ms)
        const delay4 = calculateWidgetBackoff(4);
        assert.ok(delay4 >= 270000 && delay4 <= 330000, `Delay4 (${delay4}) out of range [270000, 330000]`);

        // Verify jitter generates different values on subsequent calculations
        const sampleA = calculateWidgetBackoff(2);
        const sampleB = calculateWidgetBackoff(2);
        const sampleC = calculateWidgetBackoff(2);
        const allIdentical = (sampleA === sampleB && sampleB === sampleC);
        assert.strictEqual(allIdentical, false, 'Jitter should introduce variance across calls');
    });

    // ==========================================
    // SUMMARY REPORT
    // ==========================================
    console.log('\n====================================================');
    console.log(`📊 RESILIENCE TEST SUMMARY: ${passedTests} PASSED | ${failedTests} FAILED`);
    console.log('====================================================');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runAllTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
