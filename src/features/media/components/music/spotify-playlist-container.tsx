'use client';

import React, { useEffect, useState } from 'react';
import { getPlaylist, getPlaylistTracks, getSpotifyAuthToken } from '@/features/media/services/spotify';
import { MusicSidebar } from '@/features/media/components/music/music-sidebar';
import { Link } from '@/i18n/routing';
import { ChevronLeft, Music2, Clock, ExternalLink, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import DOMPurify from 'isomorphic-dompurify';
import { useTranslations } from 'next-intl';

interface SpotifyPlaylistContainerProps {
    playlistId: string;
    locale: string;
}

export function SpotifyPlaylistContainer({ playlistId, locale: _locale }: SpotifyPlaylistContainerProps) {
    const t = useTranslations('media.music');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [playlist, setPlaylist] = useState<any | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [tracks, setTracks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        async function loadPlaylistData() {
            try {
                setIsLoading(true);
                const token = await getSpotifyAuthToken();
                if (!token) {
                    if (isMounted) setPlaylist(null);
                    return;
                }
                const [pData, tData] = await Promise.all([
                    getPlaylist(playlistId, token),
                    getPlaylistTracks(playlistId, 50, token)
                ]);
                if (!isMounted) return;
                setPlaylist(pData);
                setTracks(tData || []);
            } catch (err) {
                console.error('Failed to load Spotify playlist:', err);
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        loadPlaylistData();

        return () => {
            isMounted = false;
        };
    }, [playlistId]);

    if (isLoading) {
        return (
            <div className="min-h-screen pt-16 flex flex-col text-slate-200">
                <div className="flex flex-col lg:flex-row flex-1 min-h-[calc(100vh-64px)] overflow-hidden">
                    <MusicSidebar currentCategory="playlists" />
                    <main className="flex-1 overflow-hidden flex flex-col p-6 md:p-10 space-y-6">
                        <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider animate-pulse">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            <span>// BUFFERING_SPOTIFY_PLAYLIST_FEED...</span>
                        </div>
                        <div className="h-44 bg-surface border border-primary/20 cyber-clip animate-pulse p-6 flex gap-6">
                            <div className="w-36 h-36 bg-primary/20 cyber-clip shrink-0" />
                            <div className="space-y-3 flex-1 justify-center flex flex-col">
                                <div className="h-6 w-1/3 bg-primary/20" />
                                <div className="h-4 w-1/4 bg-primary/10" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <div key={n} className="h-12 bg-surface/50 border border-primary/10 cyber-clip animate-pulse" />
                            ))}
                        </div>
                    </main>
                </div>
            </div>
        );
    }

    if (!playlist) {
        return (
            <div className="min-h-screen pt-32 bg-background text-center font-mono space-y-4">
                <h1 className="text-xl text-white uppercase">// PLAYLIST_FEED_NOT_FOUND</h1>
                <Link href="/media/music" className="text-primary hover:underline text-xs">[ ← BACK_TO_AUDIO_HUB ]</Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen pt-16 flex flex-col text-slate-200">
            <div className="flex flex-col lg:flex-row flex-1 min-h-[calc(100vh-64px)] overflow-hidden">
                <MusicSidebar currentCategory="playlists" />
                <main className="flex-1 overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {/* Header Hero */}
                        <div className="relative bg-surface border-b border-primary/20 p-6 md:p-10 flex flex-col md:flex-row items-end gap-6 overflow-hidden">
                            <div className="absolute inset-0 bg-grid-cyber opacity-15 pointer-events-none" />

                            <Link href="/media/music?category=playlists" className="absolute top-6 left-6 flex items-center gap-1.5 text-primary/70 hover:text-primary transition-colors font-mono text-xs uppercase z-20">
                                <ChevronLeft className="w-4 h-4" />
                                <span>[ {t('playlist.back')} ]</span>
                            </Link>

                            <div className="relative w-40 h-40 md:w-48 md:h-48 cyber-clip overflow-hidden shadow-2xl shrink-0 border border-primary/40 bg-black mt-8 md:mt-0">
                                {playlist.images?.[0]?.url ? (
                                    <Image src={playlist.images[0].url} alt={playlist.name} fill className="object-cover opacity-85" />
                                ) : (
                                    <div className="w-full h-full bg-surface flex items-center justify-center">
                                        <Music2 className="w-16 h-16 text-primary" />
                                    </div>
                                )}
                            </div>
                            <div className="space-y-3 pb-1 font-mono">
                                <Badge className="bg-primary/20 text-primary border border-primary/40 px-2.5 py-0.5 uppercase tracking-widest text-[10px] font-bold">
                                    // SPOTIFY_PLAYLIST
                                </Badge>
                                <h1 className="text-2xl md:text-4xl font-extrabold text-white uppercase tracking-wider">
                                    {playlist.name}
                                </h1>
                                <div className="flex flex-wrap items-center gap-3 text-primary/70 text-xs">
                                    <span className="font-semibold text-white">// {playlist.owner?.display_name}</span>
                                    <span>•</span>
                                    <span>{playlist.tracks?.total} {t('playlist.songs')}</span>
                                    <span>•</span>
                                    <a
                                        href={playlist.external_urls?.spotify}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:text-white font-bold transition-colors flex items-center gap-1"
                                    >
                                        [ {t('playlist.openSpotify')} <ExternalLink className="w-3 h-3" /> ]
                                    </a>
                                </div>
                                {playlist.description && (
                                    <p className="text-primary/60 max-w-2xl line-clamp-2 text-xs" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(playlist.description) }} />
                                )}
                            </div>
                        </div>

                        {/* Tracks List */}
                        <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-4">
                            <div className="bg-surface/80 border border-primary/30 cyber-clip overflow-hidden shadow-2xl backdrop-blur-2xl">
                                <div className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_1fr_auto] gap-4 p-3.5 border-b border-primary/20 text-primary/60 text-xs font-mono font-bold uppercase tracking-wider px-6">
                                    <div className="w-8 text-center">#</div>
                                    <div>TITLE</div>
                                    <div className="hidden md:block">ALBUM</div>
                                    <div className="w-12 text-right"><Clock className="w-3.5 h-3.5 ml-auto text-primary" /></div>
                                </div>

                                <div className="divide-y divide-primary/10">
                                    {tracks.map((item: { track?: { id: string; name: string; duration_ms: number; album?: { name?: string; images?: { url: string }[] }; artists?: { name: string }[] } }, index: number) => {
                                        const track = item.track;
                                        if (!track) return null;
                                        const duration = formatDuration(track.duration_ms);

                                        return (
                                            <div key={track.id + index} className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_1fr_1fr_auto] gap-4 p-3 hover:bg-primary/10 transition-colors group px-6 items-center cursor-default font-mono">
                                                <div className="w-8 text-center text-primary/50 text-xs group-hover:text-primary transition-colors">
                                                    {(index + 1).toString().padStart(2, '0')}
                                                </div>
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="relative w-9 h-9 cyber-clip-sm overflow-hidden shrink-0 bg-black flex items-center justify-center border border-primary/30">
                                                        {track.album?.images?.[0]?.url ? (
                                                            <Image src={track.album.images[0].url} alt="" fill className="object-cover opacity-80" />
                                                        ) : (
                                                            <Music2 className="w-3.5 h-3.5 text-primary/70" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-white truncate group-hover:text-primary transition-colors text-xs uppercase">
                                                            {track.name}
                                                        </p>
                                                        <p className="text-[10px] text-primary/60 truncate">
                                                            // {track.artists?.map((a: { name: string }) => a.name).join(', ')}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="hidden md:block text-primary/60 text-xs truncate">
                                                    {track.album?.name}
                                                </div>
                                                <div className="w-12 text-right text-primary/70 text-xs">
                                                    {duration}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

function formatDuration(ms: number) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
}
