import { useState, useRef, useEffect, useCallback } from 'react';
import {
    Music2, Play, Pause, Square, Loader2, Radio,
    ListMusic, Plus, ChevronDown, ChevronUp, SkipForward, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import useMusicMan from '@/hooks/musicman/useMusicMan';
import { useConnection } from '@/components/providers/ConnectionProvider';
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

function isSupportedUrl(url: string) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|soundcloud\.com)/.test(url.trim());
}

/** True for single-track URLs that can be played immediately without a resolve round-trip. */
function isSingleTrack(url: string): boolean {
    try {
        const u = new URL(url.trim());
        if (u.hostname === 'youtu.be') return true;
        if (u.hostname.includes('youtube.com')) return !!u.searchParams.get('v');
        if (u.hostname.includes('soundcloud.com')) {
            const parts = u.pathname.split('/').filter(Boolean);
            return parts.length === 2 && !parts.includes('sets');
        }
    } catch { /* ignore */ }
    return false;
}

/** Build a lightweight stub item from a URL so playback can start immediately. */
function stubFromUrl(url: string): PlaylistItem {
    const stubId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
        const u = new URL(url.trim());
        if (u.hostname.includes('soundcloud.com')) {
            const parts = u.pathname.split('/').filter(Boolean);
            return {
                id: stubId, url,
                title:   parts.length >= 2 ? parts[parts.length - 1].replace(/-/g, ' ') : 'Loading…',
                channel: parts[0] ?? 'SoundCloud',
                duration: '—', durationMs: 0, source: 'soundcloud',
            };
        }
        const vid = u.hostname === 'youtu.be'
            ? u.pathname.slice(1).split('?')[0]
            : u.searchParams.get('v');
        if (vid) {
            return { id: vid, url, title: 'Loading…', channel: 'YouTube', duration: '—', durationMs: 0, source: 'youtube' };
        }
    } catch { /* ignore */ }
    return { id: stubId, url, title: 'Loading…', channel: '—', duration: '—', durationMs: 0 };
}

function mediaLabel(url: string): string {
    try {
        const u = new URL(url.trim());
        if (u.hostname.includes('soundcloud.com')) {
            const parts = u.pathname.split('/').filter(Boolean);
            // /artist/track → "artist — track"
            if (parts.length >= 2) return `${parts[0]} — ${parts[parts.length - 1]}`.replace(/-/g, ' ');
            return u.hostname + u.pathname;
        }
        // YouTube
        const vid = u.hostname === 'youtu.be'
            ? u.pathname.slice(1).split('?')[0]
            : u.searchParams.get('v');
        if (vid) return `youtube.com/…${vid.slice(-6)}`;
        const pid = u.searchParams.get('list');
        if (pid) return `Playlist …${pid.slice(-6)}`;
    } catch { /* ignore */ }
    return url;
}

function formatMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}


// ─── Local queue persistence ──────────────────────────────────────────────────

const MAX_QUEUE   = 27;
const STORAGE_KEY = (roomId: string) => `talk:queue:${roomId}`;

function loadQueue(roomId: string): PlaylistItem[] {
    try {
        const raw   = localStorage.getItem(STORAGE_KEY(roomId));
        const items = raw ? JSON.parse(raw) : [];
        // Clamp to max in case old data was saved before the limit existed
        return Array.isArray(items) ? items.slice(0, MAX_QUEUE) : [];
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
    const { socket } = useConnection();

    const active  = isActive(roomId);
    const paused  = isPaused(roomId);
    const playing = nowPlaying(roomId);

    const [queue, setQueue]           = useState<PlaylistItem[]>(() => loadQueue(roomId));
    const [currentIndex, setCurrentIndex] = useState(0);
    // Open by default when items already exist (survives sidebar close/reopen)
    const [queueOpen, setQueueOpen]   = useState(() => loadQueue(roomId).length > 0);
    const [urlInput, setUrlInput]     = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [resolving, setResolving]   = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Prevent double auto-advance when two events / poll ticks land before the track changes
    const transitioningRef = useRef(false);

    // Always-current reference to handlePlayNext so closures don't stale-capture it
    const handlePlayNextRef = useRef<() => Promise<void>>(() => Promise.resolve());

    // ── Background metadata resolver ──────────────────────────────
    // Called after adding a stub item — fetches real title/duration and patches
    // the queue in-place without blocking playback.

    const resolveAndUpdate = useCallback(async (url: string, stubId: string) => {
        try {
            const resolved = await resolve(url);
            if (resolved.length === 0) return;
            const r = resolved[0];
            setQueue(prev => {
                const next = prev.map(item =>
                    (item.id === stubId || item.url === url)
                        ? { ...item, id: r.id, url: r.url, title: r.title, channel: r.channel, duration: r.duration, durationMs: r.durationMs }
                        : item
                );
                saveQueue(roomId, next);
                return next;
            });
        } catch { /* stub stays — playback is unaffected */ }
    }, [resolve, roomId]);

    // ── Queue helpers ─────────────────────────────────────────────
    // Save synchronously inside each mutation so localStorage is always up-to-date
    // even if the component unmounts before a useEffect would have fired.

    const updateQueue = (next: PlaylistItem[]) => {
        setQueue(next);
        saveQueue(roomId, next);
    };

    const addToQueue = (items: PlaylistItem[]) => {
        setQueue(prev => {
            const next = [...prev, ...items];
            saveQueue(roomId, next);
            return next;
        });
    };

    const removeFromQueue = (id: string) => {
        setQueue(prev => {
            const idx = prev.findIndex(i => i.id === id);
            const next = prev.filter(i => i.id !== id);
            if (idx < currentIndex) setCurrentIndex(c => Math.max(0, c - 1));
            else if (idx === currentIndex) setCurrentIndex(0);
            saveQueue(roomId, next);
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
            saveQueue(roomId, next);
            return next;
        });
        setCurrentIndex(0);
    };

    const clearQueue = () => {
        setQueue([]);
        setCurrentIndex(0);
        saveQueue(roomId, []);
    };

    // ── Playback ──────────────────────────────────────────────────

    const playItem = async (item: PlaylistItem) => {
        // Use the stored URL when available (required for SoundCloud).
        // Fall back to reconstructing a YouTube watch URL for items saved before
        // the url field was added.
        const url = item.url ?? `https://www.youtube.com/watch?v=${item.id}`;
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
        // Remove the track that just finished; the next one slides into index 0
        const nextQueue = queue.filter((_, i) => i !== currentIndex);
        updateQueue(nextQueue);
        setCurrentIndex(0);
        setPositionMs(0);
        if (nextQueue.length > 0) {
            await playItem(nextQueue[0]);
        }
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

    // ── Seek bar position polling (position only — auto-advance via socket events) ──

    useEffect(() => {
        if (!active) {
            setPositionMs(0);
            return;
        }

        const poll = async () => {
            const status = await getStatus(roomId);
            if (status) setPositionMs(status.positionMs);
        };

        poll();
        const intervalId = setInterval(poll, 2000);
        return () => clearInterval(intervalId);
    }, [active, roomId, getStatus]);

    // ── Real-time musicman socket events ──────────────────────────

    useEffect(() => {
        if (!socket) return;

        const onTrackEnded = (d: { roomId: string }) => {
            if (d.roomId !== roomId) return;
            if (transitioningRef.current) return;
            transitioningRef.current = true;
            handlePlayNextRef.current().finally(() => {
                transitioningRef.current = false;
            });
        };

        const onStateChanged = (d: { roomId: string; paused: boolean }) => {
            // Handled by the useMusicMan hook via REST calls on the originating client.
            // For other clients in the room, update positionMs reset on resume.
            if (d.roomId !== roomId) return;
            if (!d.paused) setPositionMs(0);
        };

        socket.on('musicman:track-ended',   onTrackEnded);
        socket.on('musicman:state-changed', onStateChanged);

        return () => {
            socket.off('musicman:track-ended',   onTrackEnded);
            socket.off('musicman:state-changed', onStateChanged);
        };
    }, [socket, roomId]);

    // ── Add URL ───────────────────────────────────────────────────

    const handleAdd = async () => {
        setInputError(null);
        const url = urlInput.trim();
        if (!url) { setInputError('Paste a YouTube or SoundCloud URL'); return; }
        if (!isSupportedUrl(url)) { setInputError('Must be a YouTube or SoundCloud URL'); return; }

        const available = MAX_QUEUE - queue.length;
        if (available <= 0) {
            setInputError(`Queue is full (max ${MAX_QUEUE} tracks) — clear some tracks first`);
            return;
        }

        // ── Fast path: single tracks ──────────────────────────────
        // Add a stub item immediately so playback starts without waiting for metadata.
        // The real title/duration will fill in via a background resolve call.
        if (isSingleTrack(url)) {
            const stub     = stubFromUrl(url);
            const wasEmpty = queue.length === 0;
            addToQueue([stub]);
            setUrlInput('');
            if (!queueOpen) setQueueOpen(true);
            if (!active && wasEmpty) {
                setCurrentIndex(0);
                await playItem(stub);
            }
            resolveAndUpdate(url, stub.id); // fire-and-forget
            return;
        }

        // ── Playlist path ─────────────────────────────────────────
        // Need individual track URLs before we can play, so resolve first.
        // YouTube uses --flat-playlist (fast); SoundCloud sets also use --flat-playlist
        // now so the URL list comes back quickly with stub titles.
        setResolving(true);
        try {
            const resolved = await resolve(url);
            if (resolved.length === 0) { setInputError('No playable videos found'); return; }

            const items: PlaylistItem[] = resolved.map(r => ({
                id:         r.id,
                url:        r.url,
                title:      r.title,
                channel:    r.channel,
                duration:   r.duration,
                durationMs: r.durationMs,
                source:     r.url.includes('soundcloud.com') ? 'soundcloud' as const : 'youtube' as const,
            }));

            const toAdd    = items.slice(0, available);
            const wasEmpty = queue.length === 0;
            addToQueue(toAdd);
            setUrlInput('');
            if (!queueOpen) setQueueOpen(true);
            if (toAdd.length < items.length) {
                setInputError(`Added ${toAdd.length} of ${items.length} tracks — queue capped at ${MAX_QUEUE}`);
            }

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
                                <span className="text-xs text-emerald-400 truncate max-w-[140px]" title={queue[currentIndex]?.title ?? playing ?? ''}>
                                    {queue[currentIndex]?.title ?? (playing ? mediaLabel(playing) : 'Playing…')}
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
                            <Radio className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                ref={inputRef}
                                value={urlInput}
                                onChange={e => { setUrlInput(e.target.value); setInputError(null); }}
                                onKeyDown={handleKeyDown}
                                placeholder="YouTube or SoundCloud URL…"
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
                    <div className="flex items-center gap-2 mb-2">
                        <button
                            onClick={() => setQueueOpen(o => !o)}
                            className="flex items-center gap-2 flex-1 text-left group"
                        >
                            <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors flex-1">
                                Queue
                            </span>
                            <Badge variant="secondary" className="font-mono text-[9px] px-1.5 py-0">
                                {queue.length}/{MAX_QUEUE}
                            </Badge>
                            {queueOpen
                                ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                                : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            }
                        </button>
                        {/* Clear button — always visible so queue can be wiped even when collapsed */}
                        <button
                            onClick={clearQueue}
                            className="shrink-0 p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
                            title="Clear queue"
                        >
                            <Trash2 className="h-3 w-3" />
                        </button>
                    </div>

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
