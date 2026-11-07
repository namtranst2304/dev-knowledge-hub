import { NextResponse } from 'next/server';
import { getUserSteamId, getSteamPlayerSummary, getSteamRecentlyPlayed } from '@/features/media/lib/steam-client';
import { getSpotifyAuthToken } from '@/features/media/services/spotify';
import { spotifyFetch, type SpotifyCurrentlyPlaying } from '@/features/media/services/spotify-api';

// This endpoint reads the authenticated user's connected accounts. It must never
// share a response between requests or let an intermediary cache it.
const PRIVATE_NO_STORE_HEADERS = {
    'Cache-Control': 'private, no-store'
};

interface TelemetryPayload {
    steam: {
        personaname: string;
        avatar: string;
        state: number;
        game: string | null;
        gameId: string | null;
        playtimeForeverHours: number | null;
        playtimeRecentHours: number | null;
    } | null;
    spotify: {
        isPlaying: boolean;
        songName?: string;
        artistName?: string;
        albumArt?: string;
        progress_ms?: number;
        duration_ms?: number;
    } | null;
}

interface CachedTelemetry {
    payload: TelemetryPayload;
    timestamp: number;
}

// In-memory cache buffer (10s TTL) to prevent subrequest multiplication on rapid polling
const telemetryCache = new Map<string, CachedTelemetry>();
const inFlightTelemetry = new Map<string, Promise<TelemetryPayload>>();
const CACHE_TTL_MS = 10_000;

export async function GET() {
    try {
        // Fetch user linked account IDs
        let steamId: string | null = null;
        let spotifyToken: string | null = null;

        try {
            [steamId, spotifyToken] = await Promise.all([
                getUserSteamId().catch(() => null),
                getSpotifyAuthToken().catch(() => null)
            ]);
        } catch {
            // Unauthenticated or database resolution error
        }

        const cacheKey = `${steamId || 'anon'}:${spotifyToken ? spotifyToken.slice(-16) : 'none'}`;

        // 1. Check in-memory cache buffer
        const cached = telemetryCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return NextResponse.json(cached.payload, {
                headers: PRIVATE_NO_STORE_HEADERS
            });
        }

        // 2. Request coalescing for simultaneous polling requests
        if (inFlightTelemetry.has(cacheKey)) {
            const coalescedPayload = await inFlightTelemetry.get(cacheKey)!;
            return NextResponse.json(coalescedPayload, {
                headers: PRIVATE_NO_STORE_HEADERS
            });
        }

        // 3. Isolated fetching with fault isolation
        const fetchPromise = (async (): Promise<TelemetryPayload> => {
            // Isolated Steam telemetry
            let steamData = null;
            if (steamId) {
                try {
                    const [player, recentGames] = await Promise.all([
                        getSteamPlayerSummary(steamId).catch(() => null),
                        getSteamRecentlyPlayed(steamId).catch(() => [])
                    ]);

                    if (player) {
                        let playtimeForeverHours: number | null = null;
                        let playtimeRecentHours: number | null = null;

                        if (player.gameid && Array.isArray(recentGames)) {
                            const activeRecentGame = recentGames.find(g => String(g.appid) === String(player.gameid));
                            if (activeRecentGame) {
                                playtimeForeverHours = Number((activeRecentGame.playtime_forever / 60).toFixed(1));
                                playtimeRecentHours = Number((activeRecentGame.playtime_2weeks / 60).toFixed(1));
                            }
                        }

                        steamData = {
                            personaname: player.personaname,
                            avatar: player.avatarfull,
                            state: player.personastate,
                            game: player.gameextrainfo || null,
                            gameId: player.gameid || null,
                            playtimeForeverHours,
                            playtimeRecentHours
                        };
                    }
                } catch (steamError) {
                    console.warn('Steam telemetry unavailable (isolated):', steamError);
                    steamData = null;
                }
            }

            // Isolated Spotify telemetry (fault isolated: 401 or timeout never crashes the route)
            let spotifyData = null;
            if (spotifyToken) {
                try {
                    const currentTrack = (await spotifyFetch(
                        'me/player/currently-playing',
                        spotifyToken,
                        { cache: 'no-store' }
                    )) as SpotifyCurrentlyPlaying | null;

                    if (currentTrack && currentTrack.item) {
                        spotifyData = {
                            isPlaying: currentTrack.is_playing,
                            songName: currentTrack.item.name,
                            artistName: currentTrack.item.artists?.map(a => a.name).join(', '),
                            albumArt: currentTrack.item.album?.images?.[0]?.url,
                            progress_ms: currentTrack.progress_ms,
                            duration_ms: currentTrack.item.duration_ms
                        };
                    }
                } catch (spotifyError) {
                    console.warn('Spotify telemetry unavailable (isolated):', spotifyError);
                    spotifyData = null;
                }
            }

            return {
                steam: steamData,
                spotify: spotifyData
            };
        })();

        inFlightTelemetry.set(cacheKey, fetchPromise);
        try {
            const payload = await fetchPromise;
            telemetryCache.set(cacheKey, { payload, timestamp: Date.now() });

            // Prune old cache entries
            if (telemetryCache.size > 100) {
                const now = Date.now();
                for (const [key, entry] of telemetryCache.entries()) {
                    if (now - entry.timestamp > CACHE_TTL_MS * 3) {
                        telemetryCache.delete(key);
                    }
                }
            }

            return NextResponse.json(payload, {
                headers: PRIVATE_NO_STORE_HEADERS
            });
        } finally {
            inFlightTelemetry.delete(cacheKey);
        }

    } catch (error) {
        console.error('Now Playing API Error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch telemetry' },
            { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
        );
    }
}
