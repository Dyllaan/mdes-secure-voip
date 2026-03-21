import { useState, useRef, useEffect } from 'react';
import {
    Music2, Play, Square, Loader2, Youtube,
    ListMusic, Plus, ChevronDown, ChevronUp, Shuffle,
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

// ─── URL parsing ──────────────────────────────────────────────────────────────

function isYoutubeUrl(url: string) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(url.trim());
}

function isPlaylistUrl(url: string) {
    try {
        const u = new URL(url.trim());
        return u.searchParams.has('list');
    } catch {
        return false;
    }
}

/** Extract video ID from a YouTube URL */
function extractVideoId(url: string): string | null {
    try {
        const u = new URL(url.trim());
        // youtu.be/ID
        if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
        // youtube.com/watch?v=ID
        return u.searchParams.get('v');
    } catch {
        return null;
    }
}

/** Extract playlist ID */
function extractPlaylistId(url: string): string | null {
    try {
        return new URL(url.trim()).searchParams.get('list');
    } catch {
        return null;
    }
}

/** Build a display label from a video URL */
function videoLabel(url: string): string {
    const id = extractVideoId(url);
    if (id) return `youtube.com/…${id.slice(-6)}`;
    const pid = extractPlaylistId(url);
    if (pid) return `Playlist …${pid.slice(-6)}`;
    return url;
}

/**
 * Fetch playlist video URLs via the YouTube oEmbed / noembed trick.
 * We use the public `noembed.com` proxy — no API key needed.
 * Returns an array of watch URLs for every video in the playlist.
 *
 * Note: noembed only returns metadata for one video at a time; to get
 * all videos in a playlist without an API key we use the YouTube
 * playlist page scrape approach via a CORS proxy.
 * For simplicity we build playlist items from the list ID directly and
 * let the bot resolve them server-side — we just track them locally.
 */
async function resolveUrlToItems(rawUrl: string): Promise<PlaylistItem[]> {
    const url = rawUrl.trim();
    const playlistId = extractPlaylistId(url);
    const videoId = extractVideoId(url);

    if (playlistId && !videoId) {
        // Pure playlist URL — fetch titles via noembed for the playlist itself
        // We create a placeholder item representing the whole playlist
        const title = await fetchTitle(`https://www.youtube.com/playlist?list=${playlistId}`)
            .catch(() => `Playlist ${playlistId.slice(-6)}`);
        return [{
            id: `playlist-${playlistId}`,
            title,
            channel: 'YouTube Playlist',
            duration: '—',
            source: 'youtube' as const,
        }];
    }

    if (videoId) {
        // Single video — optionally also in a playlist
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const title = await fetchTitle(watchUrl).catch(() => videoLabel(url));
        const item: PlaylistItem = {
            id: videoId,
            title,
            channel: 'YouTube',
            duration: '—',
            source: 'youtube' as const,
        };

        // If it's also in a playlist, add a separate playlist entry after
        if (playlistId) {
            const pTitle = await fetchTitle(`https://www.youtube.com/playlist?list=${playlistId}`)
                .catch(() => `Playlist ${playlistId.slice(-6)}`);
            return [
                item,
                {
                    id: `playlist-${playlistId}`,
                    title: pTitle,
                    channel: 'YouTube Playlist',
                    duration: '—',
                    source: 'youtube' as const,
                },
            ];
        }

        return [item];
    }

    // Fallback — unknown URL shape
    return [{
        id: `url-${Date.now()}`,
        title: videoLabel(url),
        channel: 'YouTube',
        duration: '—',
        source: 'youtube' as const,
    }];
}

async function fetchTitle(url: string): Promise<string> {
    const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('noembed failed');
    const data = await res.json();
    if (data.title) return data.title;
    throw new Error('no title');
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
    const { join, leave, isActive, nowPlaying, loading, error, joinHub } = useMusicMan();

    const active = isActive(roomId);
    const playing = nowPlaying(roomId);

    const [queue, setQueue] = useState<PlaylistItem[]>(() => loadQueue(roomId));
    const [currentIndex, setCurrentIndex] = useState(0);
    const [queueOpen, setQueueOpen] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [resolving, setResolving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Persist queue to localStorage whenever it changes
    useEffect(() => {
        saveQueue(roomId, queue);
    }, [queue, roomId]);

    // ── Queue helpers ─────────────────────────────────────────────

    const updateQueue = (next: PlaylistItem[]) => setQueue(next);

    const addToQueue = (items: PlaylistItem[]) => {
        setQueue(prev => {
            const next = [...prev, ...items];
            return next;
        });
    };

    const removeFromQueue = (id: string) => {
        setQueue(prev => {
            const idx = prev.findIndex(i => i.id === id);
            const next = prev.filter(i => i.id !== id);
            // Adjust currentIndex if needed
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
        // Build the actual URL back from the item id
        let url: string;
        if (item.id.startsWith('playlist-')) {
            url = `https://www.youtube.com/playlist?list=${item.id.replace('playlist-', '')}`;
        } else {
            url = `https://www.youtube.com/watch?v=${item.id}`;
        }
        await join(roomId, url);
    };

    const handlePlayFromQueue = async (id: string) => {
        const idx = queue.findIndex(i => i.id === id);
        if (idx === -1) return;
        setCurrentIndex(idx);
        await playItem(queue[idx]);
    };

    const handlePlayNext = async () => {
        if (queue.length === 0) return;
        const next = (currentIndex + 1) % queue.length;
        setCurrentIndex(next);
        await playItem(queue[next]);
    };

    const handleStop = async () => {
        try { await leave(roomId); } catch { }
    };

    // ── Add URL ───────────────────────────────────────────────────

    const handleAdd = async () => {
        setInputError(null);
        const url = urlInput.trim();
        if (!url) { setInputError('Paste a YouTube URL or playlist'); return; }
        if (!isYoutubeUrl(url)) { setInputError('Must be a YouTube URL'); return; }

        setResolving(true);
        try {
            const items = await resolveUrlToItems(url);
            addToQueue(items);
            setUrlInput('');
            setQueueOpen(true); // reveal queue so user sees the addition

            // If nothing is playing, start the first added item immediately
            if (!active) {
                const idx = queue.length; // index of first newly added item
                setCurrentIndex(idx);
                await playItem(items[0]);
            }
        } catch {
            setInputError('Failed to resolve URL');
        } finally {
            setResolving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleAdd();
        if (e.key === 'Escape') setUrlInput('');
    };

    const isLoading = loading || resolving;

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
                                <Waveform active />
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
                                {queue.length > 1 && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                        onClick={handlePlayNext}
                                        title="Next in queue"
                                        disabled={isLoading}
                                    >
                                        <Play className="h-3 w-3" />
                                    </Button>
                                )}
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