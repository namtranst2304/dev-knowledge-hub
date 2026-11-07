'use client';

import { useEffect, useState, useRef } from 'react';
import { Gamepad2, Music2, Timer, Flame } from 'lucide-react';
import Image from 'next/image';

interface TelemetryData {
    steam: {
        personaname: string;
        avatar: string;
        state: number;
        game: string | null;
        gameId: string | null;
        playtimeForeverHours?: number | null;
        playtimeRecentHours?: number | null;
    } | null;
    spotify: {
        isPlaying: boolean;
        songName: string;
        artistName: string;
        albumArt: string;
        progress_ms: number;
        duration_ms: number;
    } | null;
}

export default function LiveWidgetPage() {
    const [data, setData] = useState<TelemetryData | null>(null);
    const [sessionSeconds, setSessionSeconds] = useState<number>(0);
    const activeGameRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let pollTimeout: ReturnType<typeof setTimeout>;
        let consecutiveFailures = 0;

        const BASE_POLL_MS = 30000;
        const MAX_POLL_MS = 300000;

        const calculateBackoff = (failures: number): number => {
            // Progressive jittered exponential backoff: 30s -> 60s -> 120s up to 300s max with ±10% jitter
            const exponentialMs = Math.min(MAX_POLL_MS, BASE_POLL_MS * Math.pow(2, failures));
            const jitterFactor = 1 + (Math.random() * 0.2 - 0.1); // ±10%
            return Math.round(exponentialMs * jitterFactor);
        };

        const fetchTelemetry = async () => {
            let nextPollMs = BASE_POLL_MS;
            try {
                const res = await fetch('/api/media/now-playing', {
                    cache: 'no-store',
                    signal: AbortSignal.timeout(8000)
                });
                if (res.ok) {
                    consecutiveFailures = 0;
                    const json: TelemetryData = await res.json();
                    if (cancelled) return;
                    setData(json);

                    // Track session start when a new game is detected
                    const currentGame = json.steam?.game || null;
                    if (currentGame && currentGame !== activeGameRef.current) {
                        activeGameRef.current = currentGame;
                        setSessionSeconds(0);
                    } else if (!currentGame) {
                        activeGameRef.current = null;
                        setSessionSeconds(0);
                    }
                } else {
                    consecutiveFailures++;
                    nextPollMs = calculateBackoff(consecutiveFailures);
                }
            } catch (e) {
                console.error('Telemetry fetch error:', e);
                consecutiveFailures++;
                nextPollMs = calculateBackoff(consecutiveFailures);
            } finally {
                if (!cancelled) pollTimeout = setTimeout(fetchTelemetry, nextPollMs);
            }
        };

        fetchTelemetry();
        return () => {
            cancelled = true;
            clearTimeout(pollTimeout);
        };
    }, []);

    // Live session timer increment every 1 second
    useEffect(() => {
        if (!data?.steam?.game) return;

        const timer = setInterval(() => {
            setSessionSeconds(prev => prev + 1);
        }, 1000);

        return () => clearInterval(timer);
    }, [data?.steam?.game]);

    if (!data) return null;

    const { steam, spotify } = data;
    
    // Hide the OBS widget when neither a game nor music is playing.
    if (!steam?.game && !spotify?.isPlaying) {
        return null;
    }

    const formatSessionTime = (totalSecs: number) => {
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;
        if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    return (
        <div className="p-4 flex flex-col gap-3 font-mono" style={{ width: '420px' }}>
            {/* Steam Module */}
            {steam?.game && (
                <div className="relative p-3.5 glass-panel border-blue-500/40 overflow-hidden flex flex-col gap-2.5 cyber-clip-sm shadow-[0_0_20px_rgba(59,130,246,0.2)]">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
                    
                    <div className="flex items-center gap-3.5 pl-1">
                        <div className="relative w-14 h-14 shrink-0 border border-blue-500/50 cyber-clip bg-black overflow-hidden shadow-inner">
                            <Image 
                                src={`https://media.steampowered.com/steamcommunity/public/images/apps/${steam.gameId}/header.jpg`} 
                                alt={steam.game} 
                                fill 
                                className="object-cover"
                                unoptimized 
                            />
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                                <div className="flex items-center gap-1.5 text-blue-400">
                                    <Gamepad2 className="w-3.5 h-3.5 animate-cyber-pulse-slow" />
                                    <span className="text-[10px] font-bold tracking-widest uppercase text-glow-cyan">NOW PLAYING</span>
                                </div>

                                {/* Live Session Time Badge */}
                                <div className="flex items-center gap-1 bg-blue-500/15 border border-blue-500/40 px-2 py-0.5 text-[10px] text-blue-300 font-bold tracking-wider cyber-clip-button">
                                    <Timer className="w-3 h-3 text-blue-400 animate-pulse" />
                                    <span>{formatSessionTime(sessionSeconds)}</span>
                                </div>
                            </div>

                            <p className="text-sm font-bold text-white truncate shadow-black drop-shadow-md">{steam.game}</p>

                            {/* Telemetry Stats */}
                            <div className="flex items-center gap-2 mt-1 text-[9px] text-blue-300/80">
                                {steam.playtimeForeverHours != null && (
                                    <span className="flex items-center gap-0.5 bg-black/40 px-1.5 py-0.5 border border-blue-500/20">
                                        TOTAL: <b className="text-white">{steam.playtimeForeverHours}h</b>
                                    </span>
                                )}
                                {steam.playtimeRecentHours != null && (
                                    <span className="flex items-center gap-0.5 bg-black/40 px-1.5 py-0.5 border border-blue-500/20">
                                        <Flame className="w-2.5 h-2.5 text-orange-400" />
                                        2W: <b className="text-white">{steam.playtimeRecentHours}h</b>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Spotify Module */}
            {spotify?.isPlaying && (
                <div className="relative p-3.5 glass-panel border-emerald-500/40 overflow-hidden flex items-center gap-4 cyber-clip-sm shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                    <div className="absolute top-0 right-0 w-1.5 h-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                    
                    <div className="relative w-13 h-13 shrink-0 rounded-full overflow-hidden border-2 border-emerald-500/60 animate-[spin_4s_linear_infinite] shadow-lg shadow-emerald-500/20">
                        {spotify.albumArt ? (
                            <Image src={spotify.albumArt} alt={spotify.songName} fill className="object-cover" />
                        ) : (
                            <div className="w-full h-full bg-black flex items-center justify-center">
                                <Music2 className="w-5 h-5 text-emerald-500" />
                            </div>
                        )}
                        {/* Center hole for vinyl effect */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-[#040612] rounded-full border border-emerald-500/40" />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-1.5 text-emerald-400 mb-0.5">
                            <Music2 className="w-3.5 h-3.5 animate-cyber-pulse-slow" />
                            <span className="text-[9px] font-bold tracking-widest uppercase" style={{ textShadow: '0 0 12px rgba(16,185,129,0.75)' }}>AUDIO STREAM</span>
                        </div>
                        <p className="text-sm font-bold text-white truncate drop-shadow-md">{spotify.songName}</p>
                        <p className="text-[11px] text-emerald-100/70 truncate">{spotify.artistName}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
