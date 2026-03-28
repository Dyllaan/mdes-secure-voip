import { useState, useRef, useEffect, useCallback } from 'react';
import {
    Music2, Play, Pause, Square, Loader2, Youtube,
    ListMusic, Plus, ChevronDown, ChevronUp, SkipForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import useMusicMan from '@/hooks/musicman/useMusicMan';
import Playlist, { type PlaylistItem } from './Playlist';

interface MusicmanPanelProps {
    roomId: string;
    hubId: string;
    hasMusicman: boolean;
    onBotJoined: () => void;
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({ active }: { active: boolean }) {
    return (
        <div className="flex items-end gap-[2px] h-4">
            {[0.6, 1, 0.75, 0.9, 0.5].map((height, i) => (
                <span
                    key={i}
                    className="w-[3px] rounded-full bg-emerald-400 transition-all"
                    style={{
                        height: active ? `${height * 100}%` : '20%',
                        opacity: active ? 1 : 0.3,
                        animation: active
                            ? `musicbar ${0.8 + i * 0.15}s ease-in-out infinite alternate`
                            : 'none',
                        animationDelay: `${i * 0.1}s`,
                    }}
                />
            ))}
            <style>{`
        @keyframes musicbar {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.0); }
        }
      `}</style>
        </div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isYoutubeUrl(url: string) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(url.trim());
}

function extractVideoId(url: string): string | null {
    try {
        const u = new URL(url.trim());
        if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
        return u.searchParams.get('v');
    } catch {
        return null;
    }
}

function extractPlaylistId(url: string): string | null {
    try {
        return new URL(url.trim()).searchParams.get('list');
    } catch {
        return null;
    }
}

function videoLabel(url: string): string {
    const id = extractVideoId(url);
    if (id) return `youtube.com/…${id.slice(-6)}`;
    const pid = extractPlaylistId(url);
    if (pid) return `Playlist …${pid.slice(-6)}`;
    return url;
}

function formatMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}


// ─── Local queue persistence ──────────────────────────────────────────────────

const STORAGE_KEY = (roomId: string) => `talk:queue:${roomId}`;

function loadQueue(roomId: string): PlaylistItem[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY(roomId));
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveQueue(roomId: string, items: PlaylistItem[]) {
    try {
        localStorage.setItem(STORAGE_KEY(roomId), JSON.stringify(items));
    } catch { }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MusicmanPanel({ roomId, hubId, hasMusicman, onBotJoined }: MusicmanPanelProps) {
    const {
        play, leave, pause, resume, seek, getStatus, resolve,
        isActive, isPaused, nowPlaying, loading, error, joinHub,
    } = useMusicMan();

    const active  = isActive(roomId);
    const paused  = isPaused(roomId);
    const playing = nowPlaying(roomId);

    const [queue, setQueue]           = useState<PlaylistItem[]>(() => loadQueue(roomId));
    const [currentIndex, setCurrentIndex] = useState(0);
    const [queueOpen, setQueueOpen]   = useState(false);
    const [urlInput, setUrlInput]     = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [resolving, setResolving]   = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Prevent double auto-advance when two poll ticks land before the track changes
    const transitioningRef = useRef(false);

    // Always-current reference to handlePlayNext so the polling closure doesn't stale-capture it
    const handlePlayNextRef = useRef<() => Promise<void>>(() => Promise.resolve());

    // Persist queue to localStorage whenever it changes
    useEffect(() => {
        saveQueue(roomId, queue);
    }, [queue, roomId]);

    // ── Queue helpers ─────────────────────────────────────────────

    const updateQueue = (next: PlaylistItem[]) => setQueue(next);

    const addToQueue = (items: PlaylistItem[]) => {
        setQueue(prev => [...prev, ...items]);
    };

    const removeFromQueue = (id: string) => {
        setQueue(prev => {
            const idx = prev.findIndex(i => i.id === id);
            const next = prev.filter(i => i.id !== id);
            if (idx < currentIndex) setCurrentIndex(c => Math.max(0, c - 1));
            else if (idx === currentIndex) setCurrentIndex(0);
            return next;
        });
    };

    const shuffleQueue = () => {
        setQueue(prev => {
            const next = [...prev];
            for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
            }
            return next;
        });
        setCurrentIndex(0);
    };

    const clearQueue = () => {
        setQueue([]);
        setCurrentIndex(0);
    };

    // ── Playback ──────────────────────────────────────────────────

    const playItem = async (item: PlaylistItem) => {
        let url: string;
        if (item.id.startsWith('playlist-')) {
            url = `https://www.youtube.com/playlist?list=${item.id.replace('playlist-', '')}`;
        } else {
            url = `https://www.youtube.com/watch?v=${item.id}`;
        }
        setPositionMs(0);
        await play(roomId, url);
    };

    const handlePlayFromQueue = async (id: string) => {
        const idx = queue.findIndex(i => i.id === id);
        if (idx === -1) return;
        setCurrentIndex(idx);
        await playItem(queue[idx]);
    };

    const handlePlayNext = useCallback(async () => {
        if (queue.length === 0) return;
        const next = (currentIndex + 1) % queue.length;
        setCurrentIndex(next);
        await playItem(queue[next]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue, currentIndex]);

    // Keep the ref current so the polling closure always calls the latest version
    useEffect(() => {
        handlePlayNextRef.current = handlePlayNext;
    }, [handlePlayNext]);

    const handlePauseResume = async () => {
        if (paused) {
            await resume(roomId);
        } else {
            await pause(roomId);
        }
    };

    const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const seconds = Number(e.target.value);
        setPositionMs(seconds * 1000); // optimistic update
        await seek(roomId, seconds);
    };

    const handleStop = async () => {
        try {
            await leave(roomId);
            setPositionMs(0);
        } catch { }
    };

    // ── Status polling ────────────────────────────────────────────

    useEffect(() => {
        if (!active) {
            setPositionMs(0);
            return;
        }

        const poll = async () => {
            const status = await getStatus(roomId);
            if (!status) return;

            setPositionMs(status.positionMs);

            // Sync paused state if page was refreshed (pausedRooms is in-memory only)
            // The hook's isPaused() will be correct after the first poll since the hook
            // state is updated via pause()/resume() calls — this is just informational.

            // Auto-advance when the track ends (pipeline stopped, not paused)
            if (!status.playing && !status.paused && !transitioningRef.current) {
                transitioningRef.current = true;
                try {
                    await handlePlayNextRef.current();
                } finally {
                    transitioningRef.current = false;
                }
            }
        };

        poll();
        const intervalId = setInterval(poll, 2000);
        return () => clearInterval(intervalId);
    }, [active, roomId, getStatus]);

    // ── Add URL ───────────────────────────────────────────────────

    const handleAdd = async () => {
        setInputError(null);
        const url = urlInput.trim();
        if (!url) { setInputError('Paste a YouTube URL or playlist'); return; }
        if (!isYoutubeUrl(url)) { setInputError('Must be a YouTube URL'); return; }

        setResolving(true);
        try {
            // Resolve via the backend (yt-dlp) so playlists expand into individual tracks
            const resolved = await resolve(url);
            if (resolved.length === 0) { setInputError('No playable videos found'); return; }

            const items: PlaylistItem[] = resolved.map(r => ({
                id:         r.id,
                title:      r.title,
                channel:    r.channel,
                duration:   r.duration,
                durationMs: r.durationMs,
                source:     'youtube' as const,
            }));

            const wasEmpty = queue.length === 0;
            addToQueue(items);
            setUrlInput('');
            setQueueOpen(true);

            // If nothing is playing, start the first added item immediately
            if (!active && wasEmpty) {
                setCurrentIndex(0);
                await playItem(items[0]);
            }
        } catch {
            setInputError('Failed to resolve URL — check the bot is running');
        } finally {
            setResolving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleAdd();
        if (e.key === 'Escape') setUrlInput('');
    };

    const isLoading = loading || resolving;

    // Duration of the currently-playing item (for seek bar max)
    const currentDurationMs = (active && queue[currentIndex]?.durationMs) || 0;
    const seekMax = currentDurationMs > 0 ? Math.floor(currentDurationMs / 1000) : 3600;

    // ── Render ────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-0">

            {/* ── Now playing / status bar ──────────────────────── */}
            <div className={`
                rounded-lg border transition-all duration-200 overflow-hidden
                ${active ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-border bg-muted/30'}
            `}>
                <div className="flex items-center gap-2 px-3 py-2">

                    {/* Icon + state */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Music2 className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-emerald-400' : 'text-muted-foreground'}`} />

                        {active ? (
                            <div className="flex items-center gap-2 min-w-0">
                                <Waveform active={!paused} />
                                <span className="text-xs text-emerald-400 truncate max-w-[140px]" title={playing ?? ''}>
                                    {playing ? videoLabel(playing) : 'Playing…'}
                                </span>
                            </div>
                        ) : (
                            <span className="text-xs text-muted-foreground">Music Bot</span>
                        )}
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                        {active && (
                            <>
                                {/* Pause / Resume */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                    onClick={handlePauseResume}
                                    disabled={isLoading}
                                    title={paused ? 'Resume' : 'Pause'}
                                >
                                    {paused
                                        ? <Play className="h-3 w-3" />
                                        : <Pause className="h-3 w-3" />
                                    }
                                </Button>

                                {/* Skip to next */}
                                {queue.length > 1 && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                        onClick={handlePlayNext}
                                        title="Next in queue"
                                        disabled={isLoading}
                                    >
                                        <SkipForward className="h-3 w-3" />
                                    </Button>
                                )}

                                {/* Stop */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/30"
                                    onClick={handleStop}
                                    disabled={isLoading}
                                    title="Stop"
                                >
                                    {isLoading
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : <Square className="h-3 w-3 fill-current" />
                                    }
                                </Button>
                            </>
                        )}

                        {!hasMusicman && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs text-muted-foreground hover:text-foreground px-2"
                                onClick={async () => { await joinHub(hubId); onBotJoined(); }}
                                disabled={isLoading}
                            >
                                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '+ Add bot'}
                            </Button>
                        )}
                    </div>
                </div>

                {/* Seek bar — shown when active */}
                {active && (
                    <div className="flex items-center gap-2 px-3 pb-2">
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-10 text-right shrink-0">
                            {formatMs(positionMs)}
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={seekMax}
                            value={Math.min(Math.floor(positionMs / 1000), seekMax)}
                            onChange={handleSeek}
                            className="flex-1 h-1 accent-emerald-400 cursor-pointer"
                            title="Seek"
                        />
                        {currentDurationMs > 0 && (
                            <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-10 shrink-0">
                                {formatMs(currentDurationMs)}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* ── URL input ─────────────────────────────────────── */}
            {hasMusicman && (
                <div className="flex flex-col gap-1.5 mt-3">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Youtube className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                ref={inputRef}
                                value={urlInput}
                                onChange={e => { setUrlInput(e.target.value); setInputError(null); }}
                                onKeyDown={handleKeyDown}
                                placeholder="YouTube URL or playlist…"
                                className="h-8 text-xs pl-7 bg-background/50"
                            />
                        </div>
                        <Button
                            size="sm"
                            className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 gap-1.5"
                            onClick={handleAdd}
                            disabled={isLoading}
                        >
                            {isLoading
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <><Plus className="h-3 w-3" /> Add</>
                            }
                        </Button>
                    </div>

                    {(inputError || error) && (
                        <p className="text-xs text-red-400 px-1">{inputError ?? error}</p>
                    )}
                </div>
            )}

            {/* ── Queue ─────────────────────────────────────────── */}
            {queue.length > 0 && (
                <div className="mt-3">
                    <Separator className="mb-3" />

                    {/* Queue toggle header */}
                    <button
                        onClick={() => setQueueOpen(o => !o)}
                        className="flex items-center gap-2 w-full text-left mb-2 group"
                    >
                        <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors flex-1">
                            Queue
                        </span>
                        <Badge variant="secondary" className="font-mono text-[9px] px-1.5 py-0">
                            {queue.length}
                        </Badge>
                        {queueOpen
                            ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                            : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        }
                    </button>

                    {queueOpen && (
                        <Playlist
                            items={queue}
                            currentIndex={active ? currentIndex : -1}
                            onReorder={updateQueue}
                            onRemove={removeFromQueue}
                            onPlay={handlePlayFromQueue}
                            onShuffle={queue.length > 1 ? shuffleQueue : undefined}
                            onClear={clearQueue}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
