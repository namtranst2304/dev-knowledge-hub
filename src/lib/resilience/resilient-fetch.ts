/**
 * Core Resilient Fetch Utility
 *
 * Implements strict timeouts, in-flight request coalescing, short-term in-memory TTL caching,
 * exponential backoff with jitter on retryable failures, and payload size guardrails.
 * Designed to operate within Cloudflare Worker resource constraints (CPU execution limits and subrequest budgets).
 */

export interface ResilientFetchOptions extends Omit<RequestInit, 'signal'> {
    /** Timeout in milliseconds (default: 4000ms). Use 0 for immediate abort boundary testing. */
    timeoutMs?: number;
    /** Number of retry attempts on 5xx, 429, or network errors (default: 1 on 5xx/429/network errors, 0 on 4xx). */
    retries?: number;
    /** Base delay for exponential backoff in milliseconds (default: 200ms). */
    backoffBaseMs?: number;
    /** Maximum delay cap for exponential backoff in milliseconds (default: 2000ms). */
    backoffMaxMs?: number;
    /** In-memory cache TTL in milliseconds (default: 0 = disabled). */
    cacheTtlMs?: number;
    /** Explicit deduplication key for in-flight request coalescing (defaults to method:url for GET). */
    coalesceKey?: string;
    /** Maximum payload size in bytes (default: 1,048,576 = 1MB). */
    maxBytes?: number;
    /** Expected response format: 'auto' | 'json' | 'text' (default: 'auto'). */
    responseType?: 'auto' | 'json' | 'text';
    /** Optional caller-provided AbortSignal. */
    signal?: AbortSignal | null;
}

export interface ResilientFetchResult<T> {
    ok: boolean;
    status: number;
    data: T | null;
    error?: Error;
    cached?: boolean;
    headers?: Headers;
}

interface CacheEntry<T> {
    data: T;
    status: number;
    headers?: Headers;
    expiresAt: number;
}

// In-memory cache for short TTL responses (per worker instance)
const memoryCache = new Map<string, CacheEntry<unknown>>();

// In-flight promise map for request coalescing / deduplication
const inFlightRequests = new Map<string, Promise<ResilientFetchResult<unknown>>>();

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function pruneExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of memoryCache.entries()) {
        if (entry.expiresAt <= now) {
            memoryCache.delete(key);
        }
    }
}

async function sleepWithBackoff(
    attempt: number,
    baseMs: number,
    maxMs: number,
    retryAfterHeader: string | null,
    signal?: AbortSignal | null
): Promise<void> {
    let delayMs = 0;
    if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsed) && parsed > 0) {
            delayMs = parsed * 1000;
        }
    }

    if (delayMs <= 0) {
        const exponentialDelay = Math.min(maxMs, baseMs * Math.pow(2, attempt));
        // ±20% jitter
        const jitter = (Math.random() * 0.4 - 0.2) * exponentialDelay;
        delayMs = Math.max(10, Math.round(exponentialDelay + jitter));
    }

    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            return reject(signal.reason ?? new Error('Aborted'));
        }

        const timer = setTimeout(() => {
            resolve();
        }, delayMs);

        if (signal) {
            const onAbort = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                reject(signal.reason ?? new Error('Aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

/**
 * Standardized resilient fetch wrapper.
 */
export async function resilientFetch<T = unknown>(
    url: string,
    options?: ResilientFetchOptions
): Promise<ResilientFetchResult<T>> {
    const method = (options?.method || 'GET').toUpperCase();
    const cacheTtlMs = options?.cacheTtlMs ?? 0;
    const cacheKey = options?.coalesceKey ?? `${method}:${url}`;

    // 1. Check in-memory TTL cache (if cacheTtlMs > 0)
    if (cacheTtlMs > 0) {
        const cached = memoryCache.get(cacheKey) as CacheEntry<T> | undefined;
        if (cached) {
            if (Date.now() < cached.expiresAt) {
                return {
                    ok: true,
                    status: cached.status,
                    data: cached.data,
                    cached: true,
                    headers: cached.headers,
                };
            }
            memoryCache.delete(cacheKey);
        }
    }

    // 2. In-flight promise coalescing / deduplication key
    const coalesceKey = options?.coalesceKey ?? (method === 'GET' ? url : undefined);
    if (coalesceKey) {
        const existingPromise = inFlightRequests.get(coalesceKey);
        if (existingPromise) {
            return existingPromise as Promise<ResilientFetchResult<T>>;
        }
    }

    const execute = async (): Promise<ResilientFetchResult<T>> => {
        const timeoutMs = options?.timeoutMs ?? 4000;
        const retries = options?.retries ?? 1;
        const maxBytes = options?.maxBytes ?? 1_048_576; // 1MB default
        const backoffBaseMs = options?.backoffBaseMs ?? 200;
        const backoffMaxMs = options?.backoffMaxMs ?? 2000;
        const responseType = options?.responseType ?? 'auto';

        const {
            timeoutMs: _t,
            retries: _r,
            backoffBaseMs: _bb,
            backoffMaxMs: _bm,
            cacheTtlMs: _c,
            coalesceKey: _ck,
            maxBytes: _mb,
            responseType: _rt,
            signal: _s,
            ...fetchInit
        } = options || {};

        for (let attempt = 0; attempt <= retries; attempt++) {
            let timeoutSignal: AbortSignal | undefined;
            if (timeoutMs >= 0) {
                timeoutSignal = AbortSignal.timeout(timeoutMs);
            }

            let effectiveSignal: AbortSignal | undefined = timeoutSignal;
            if (options?.signal) {
                effectiveSignal = timeoutSignal
                    ? AbortSignal.any([options.signal, timeoutSignal])
                    : options.signal;
            }

            let response: Response;
            try {
                response = await fetch(url, {
                    ...fetchInit,
                    signal: effectiveSignal,
                });
            } catch (fetchError: unknown) {
                const err = fetchError instanceof Error ? fetchError : new Error(String(fetchError));
                const isTimeout =
                    err.name === 'TimeoutError' || (err.name === 'AbortError' && timeoutSignal?.aborted);
                const isUserAbort = options?.signal?.aborted;

                if (isUserAbort) {
                    return {
                        ok: false,
                        status: 499,
                        data: null,
                        error: err,
                    };
                }

                if (attempt < retries) {
                    try {
                        await sleepWithBackoff(attempt, backoffBaseMs, backoffMaxMs, null, options?.signal);
                        continue;
                    } catch (abortErr) {
                        return {
                            ok: false,
                            status: 499,
                            data: null,
                            error: abortErr instanceof Error ? abortErr : new Error(String(abortErr)),
                        };
                    }
                }

                return {
                    ok: false,
                    status: isTimeout ? 504 : 0,
                    data: null,
                    error: isTimeout ? new Error(`Request timed out after ${timeoutMs}ms`) : err,
                };
            }

            // Check retryable status codes
            if (!response.ok) {
                if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < retries) {
                    const retryAfter = response.headers.get('retry-after');
                    try {
                        await sleepWithBackoff(attempt, backoffBaseMs, backoffMaxMs, retryAfter, options?.signal);
                        continue;
                    } catch (abortErr) {
                        return {
                            ok: false,
                            status: 499,
                            data: null,
                            error: abortErr instanceof Error ? abortErr : new Error(String(abortErr)),
                            headers: response.headers,
                        };
                    }
                }

                return {
                    ok: false,
                    status: response.status,
                    data: null,
                    error: new Error(`HTTP ${response.status}: ${response.statusText || 'Error'}`),
                    headers: response.headers,
                };
            }

            // Guardrail 1: Check Content-Length header against maxBytes
            const contentLengthHeader = response.headers.get('content-length');
            if (contentLengthHeader) {
                const contentLength = parseInt(contentLengthHeader, 10);
                if (!isNaN(contentLength) && contentLength > maxBytes) {
                    return {
                        ok: false,
                        status: 413,
                        data: null,
                        error: new Error(`Payload exceeds maximum allowed size of ${maxBytes} bytes (Content-Length: ${contentLength})`),
                        headers: response.headers,
                    };
                }
            }

            // Handle 204 No Content or null body
            if (response.status === 204 || !response.body) {
                return {
                    ok: true,
                    status: response.status,
                    data: null,
                    headers: response.headers,
                };
            }

            // Guardrail 2: Stream read body with maxBytes enforcement
            let bodyText: string;
            try {
                if (typeof response.body.getReader === 'function') {
                    const reader = response.body.getReader();
                    const chunks: Uint8Array[] = [];
                    let totalBytes = 0;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            totalBytes += value.byteLength;
                            if (totalBytes > maxBytes) {
                                await reader.cancel();
                                return {
                                    ok: false,
                                    status: 413,
                                    data: null,
                                    error: new Error(`Payload exceeds maximum allowed size of ${maxBytes} bytes`),
                                    headers: response.headers,
                                };
                            }
                            chunks.push(value);
                        }
                    }

                    const combined = new Uint8Array(totalBytes);
                    let offset = 0;
                    for (const chunk of chunks) {
                        combined.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    bodyText = new TextDecoder().decode(combined);
                } else {
                    bodyText = await response.text();
                    const encodedLength = new TextEncoder().encode(bodyText).length;
                    if (encodedLength > maxBytes) {
                        return {
                            ok: false,
                            status: 413,
                            data: null,
                            error: new Error(`Payload exceeds maximum allowed size of ${maxBytes} bytes`),
                            headers: response.headers,
                        };
                    }
                }
            } catch (readErr: unknown) {
                return {
                    ok: false,
                    status: 500,
                    data: null,
                    error: readErr instanceof Error ? readErr : new Error(String(readErr)),
                    headers: response.headers,
                };
            }

            // Parse response according to responseType
            const contentType = response.headers.get('content-type') || '';
            let parsedData: T;

            if (responseType === 'text') {
                parsedData = bodyText as unknown as T;
            } else if (responseType === 'json') {
                try {
                    parsedData = JSON.parse(bodyText) as T;
                } catch (parseError) {
                    return {
                        ok: false,
                        status: response.status,
                        data: null,
                        error: new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`),
                        headers: response.headers,
                    };
                }
            } else {
                // 'auto' mode
                if (contentType.includes('application/json')) {
                    try {
                        parsedData = JSON.parse(bodyText) as T;
                    } catch (parseError) {
                        return {
                            ok: false,
                            status: response.status,
                            data: null,
                            error: new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`),
                            headers: response.headers,
                        };
                    }
                } else {
                    const trimmed = bodyText.trim();
                    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                        try {
                            parsedData = JSON.parse(bodyText) as T;
                        } catch {
                            parsedData = bodyText as unknown as T;
                        }
                    } else {
                        parsedData = bodyText as unknown as T;
                    }
                }
            }

            // Store in in-memory cache if TTL > 0
            if (cacheTtlMs > 0) {
                pruneExpiredCache();
                memoryCache.set(cacheKey, {
                    data: parsedData,
                    status: response.status,
                    headers: response.headers,
                    expiresAt: Date.now() + cacheTtlMs,
                });
            }

            return {
                ok: true,
                status: response.status,
                data: parsedData,
                cached: false,
                headers: response.headers,
            };
        }

        // Fallback for exhausted attempts
        return {
            ok: false,
            status: 500,
            data: null,
            error: new Error('Request attempts exhausted'),
        };
    };

    if (coalesceKey) {
        const promise = execute();
        inFlightRequests.set(coalesceKey, promise as Promise<ResilientFetchResult<unknown>>);
        try {
            return await promise;
        } finally {
            inFlightRequests.delete(coalesceKey);
        }
    }

    return execute();
}

/** Clear all entries in the resilient fetch in-memory cache (useful for testing). */
export function clearResilientFetchCache(): void {
    memoryCache.clear();
}

/** Get the current number of cached items in the in-memory cache. */
export function getResilientFetchCacheSize(): number {
    return memoryCache.size;
}
