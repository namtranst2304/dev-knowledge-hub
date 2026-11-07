export interface SpotifyPlaylistItem {
    id: string;
    name: string;
    uri: string;
    description?: string;
    images?: { url: string }[];
}

export interface SpotifyArtist {
    name: string;
    id?: string;
    uri?: string;
}

export interface SpotifyTrackItem {
    id: string;
    name: string;
    uri: string;
    duration_ms: number;
    artists?: SpotifyArtist[];
    album?: {
        name: string;
        images?: { url: string }[];
    };
}

export interface SpotifyCurrentlyPlaying {
    is_playing: boolean;
    progress_ms: number;
    item?: SpotifyTrackItem | null;
}

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/api/auth/spotify/callback';

const SCOPES = [
    'user-read-private',
    'user-read-email',
    'user-top-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-modify-playback-state',
    'user-read-playback-state'
].join(' ');

export function getSpotifyAuthUrl(state?: string) {
    const params = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID!,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        show_dialog: 'true'
    });

    if (state) params.set('state', state);

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function getSpotifyTokens(code: string) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI
        }),
        signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to get tokens: ${JSON.stringify(error)}`);
    }

    return response.json();
}

export async function refreshSpotifyToken(refreshToken: string) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }),
        signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to refresh token: ${JSON.stringify(error)}`);
    }

    return response.json();
}

export async function spotifyFetch(endpoint: string, accessToken: string, init?: RequestInit) {
    try {
        const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            next: { revalidate: 3600 }, // Cache for 1 hour default
            signal: AbortSignal.timeout(5000),
            ...init
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Unauthorized');
            }
            return null;
        }

        if (response.status === 204) {
            return null; // Handle 204 No Content for currently-playing
        }

        return response.json();
    } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') throw error;
        console.error(`Spotify fetch error for ${endpoint}:`, error);
        return null;
    }
}

export async function playSpotifyContext(accessToken: string, contextUri: string): Promise<{ success?: boolean; error?: string }> {
    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/play', {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ context_uri: contextUri }),
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok && response.status !== 204) {
            // 404 means no active device found
            if (response.status === 404) return { error: 'NO_ACTIVE_DEVICE' };
            const error = await response.json().catch(() => ({}));
            console.error('Spotify Playback Error:', error);
            return { error: 'Failed to play context' };
        }
        return { success: true };
    } catch (error) {
        console.error('Spotify Playback Network/Timeout Error:', error);
        return { error: error instanceof Error ? error.message : 'Failed to play context' };
    }
}

export async function searchSpotifyPlaylists(accessToken: string, query: string): Promise<SpotifyPlaylistItem[]> {
    try {
        const params = new URLSearchParams({
            q: query,
            type: 'playlist',
            limit: '15'
        });
        const response = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) return [];
        const data = (await response.json()) as { playlists?: { items?: SpotifyPlaylistItem[] } };
        return data.playlists?.items || [];
    } catch (error) {
        console.error('Spotify search playlists error:', error);
        return [];
    }
}
