import { useState, useRef, useEffect } from 'react';
import {
    Music2, Play, Pause, Square, Loader2, Radio,
    ListMusic, Plus, ChevronDown, ChevronUp, SkipForward, Trash2, Cast,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import useMusicMan from '@/hooks/musicman/useMusicMan';
import { useConnection } from '@/components/providers/ConnectionProvider';
import Playlist, { type PlaylistItem } from './Playlist';
import type { MusicRoomStateEvent } from './types';
import { toast } from 'sonner';

interface MusicmanPanelProps {
    roomId: string;
    hubId: string;
    hasMusicman: boolean;
    onBotJoined: () => void;
}

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

function isSupportedUrl(url: string) {
    return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|soundcloud\.com)/.test(url.trim());
}

function mediaLabel(url: string): string {
    try {
        const u = new URL(url.trim());
        if (u.hostname.includes('soundcloud.com')) {
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length >= 2) return `${parts[0]} - ${parts[parts.length - 1]}`.replace(/-/g, ' ');
            return u.hostname + u.pathname;
        }
        const vid = u.hostname === 'youtu.be'
            ? u.pathname.slice(1).split('?')[0]
            : u.searchParams.get('v');
        if (vid) return `youtube.com/...${vid.slice(-6)}`;
        const pid = u.searchParams.get('list');
        if (pid) return `Playlist ...${pid.slice(-6)}`;
    } catch {
        toast.error('Invalid URL');
    }
    return url;
}

function formatMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

const MAX_QUEUE = 27;

export default function MusicmanPanel({ roomId, hubId, hasMusicman, onBotJoined }: MusicmanPanelProps) {
    const {
        addQueueItems,
        clearQueue,
        leave,
        pause,
        resume,
        seek,
        getStatus,
        resolve,
        isActive,
        nowPlaying,
        loading,
        error,
        joinHub,
        getRoomState,
        removeQueueItem,
        reorderQueue,
        shuffleQueue,
        playQueueItem,
        playNext,
        applySessionStateEvent,
    } = useMusicMan();
    const { socket } = useConnection();

    const active = isActive(roomId);
    const roomState = getRoomState(roomId);
    const paused = roomState?.paused ?? false;
    const playing = nowPlaying(roomId);
    const queue = roomState?.queue ?? [];
    const currentIndex = roomState?.currentIndex ?? 0;
    const currentTrack = roomState?.currentTrack ?? null;
    const activeVideoMode = roomState?.videoMode ?? false;

    const [queueOpen, setQueueOpen] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [resolving, setResolving] = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const [botJoined, setBotJoined] = useState(hasMusicman);
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(null);

    const [videoMode, setVideoMode] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const seekInteractionRef = useRef(false);
    const seekPreviewSecondsRef = useRef<number | null>(null);
    const botAvailable = hasMusicman || botJoined || active;
    const currentDurationMs = currentTrack?.durationMs ?? 0;
    const seekEnabled = currentDurationMs > 0;
    const seekMax = seekEnabled ? Math.floor(currentDurationMs / 1000) : 0;
    const clampSeekSeconds = (seconds: number) => {
        if (!Number.isFinite(seconds) || !seekEnabled) return 0;
        return Math.min(Math.max(0, Math.floor(seconds)), seekMax);
    };

    useEffect(() => {
        if (hasMusicman) setBotJoined(true);
    }, [hasMusicman]);

    useEffect(() => {
        if (queue.length > 0) setQueueOpen(true);
    }, [queue.length]);

    useEffect(() => {
        if (!isSeeking) setPositionMs(roomState?.positionMs ?? 0);
        if (!active) {
            setVideoMode(false);
            setIsSeeking(false);
            setSeekPreviewSeconds(null);
            seekInteractionRef.current = false;
            seekPreviewSecondsRef.current = null;
        }
    }, [active, isSeeking, roomState?.positionMs]);

    useEffect(() => {
        void getStatus(roomId);
    }, [getStatus, roomId]);

    useEffect(() => {
        if (!active) {
            setPositionMs(0);
            return;
        }

        const poll = async () => {
            const status = await getStatus(roomId);
            if (!status) setPositionMs(0);
        };

        const intervalId = setInterval(poll, 5000);
        return () => clearInterval(intervalId);
    }, [active, roomId, getStatus]);

    useEffect(() => {
        if (!socket) return;

        const onSessionState = (event: MusicRoomStateEvent) => {
            if (event.roomId !== roomId) return;
            applySessionStateEvent(event);
            if (!event.active) {
                setPositionMs(0);
                setIsSeeking(false);
                setSeekPreviewSeconds(null);
                seekInteractionRef.current = false;
                seekPreviewSecondsRef.current = null;
            } else if (event.state && !seekInteractionRef.current) {
                setPositionMs(event.state.positionMs);
            }
        };

        socket.on('musicman:session-state', onSessionState);
        return () => {
            socket.off('musicman:session-state', onSessionState);
        };
    }, [applySessionStateEvent, roomId, socket]);

    const handlePauseResume = async () => {
        if (paused) {
            await resume(roomId);
        } else {
            await pause(roomId);
        }
    };

    const startSeekInteraction = () => {
        if (!seekEnabled) return;
        seekInteractionRef.current = true;
        setIsSeeking(true);
    };

    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const seconds = clampSeekSeconds(Number(e.target.value));
        if (!seekInteractionRef.current) {
            startSeekInteraction();
        }
        seekPreviewSecondsRef.current = seconds;
        setSeekPreviewSeconds(seconds);
        setPositionMs(seconds * 1000);
    };

    const commitSeek = async () => {
        if (!seekInteractionRef.current || !seekEnabled) return;
        const seconds = clampSeekSeconds(
            seekPreviewSecondsRef.current ?? seekPreviewSeconds ?? Math.floor(positionMs / 1000),
        );
        setPositionMs(seconds * 1000);
        try {
            await seek(roomId, seconds);
        } finally {
            seekInteractionRef.current = false;
            seekPreviewSecondsRef.current = null;
            setIsSeeking(false);
            setSeekPreviewSeconds(null);
        }
    };

    const cancelSeekInteraction = () => {
        seekInteractionRef.current = false;
        seekPreviewSecondsRef.current = null;
        setIsSeeking(false);
        setSeekPreviewSeconds(null);
        setPositionMs(roomState?.positionMs ?? 0);
    };

    const handleSeekKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            startSeekInteraction();
        }
    };

    const handleSeekKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            void commitSeek();
        }
    };

    const handleStop = async () => {
        try {
            await leave(roomId);
            setPositionMs(0);
        } catch {
            toast.error('Failed to stop playback');
        }
    };

    const handleAdd = async () => {
        setInputError(null);
        const url = urlInput.trim();
        if (!url) {
            setInputError('Paste a YouTube or SoundCloud URL');
            return;
        }
        if (!isSupportedUrl(url)) {
            setInputError('Must be a YouTube or SoundCloud URL');
            return;
        }

        const available = MAX_QUEUE - queue.length;
        if (available <= 0) {
            setInputError(`Queue is full (max ${MAX_QUEUE} tracks) - clear some tracks first`);
            return;
        }

        setResolving(true);
        try {
            const resolved = await resolve(url);
            if (resolved.length === 0) {
                setInputError('No playable videos found');
                return;
            }

            const items = resolved.slice(0, available);
            await addQueueItems(roomId, items, active ? activeVideoMode : videoMode);
            setUrlInput('');
            setQueueOpen(true);
            if (items.length < resolved.length) {
                setInputError(`Added ${items.length} of ${resolved.length} tracks - queue capped at ${MAX_QUEUE}`);
            }
        } catch {
            setInputError('Failed to resolve URL - check the bot is running');
        } finally {
            setResolving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') void handleAdd();
        if (e.key === 'Escape') setUrlInput('');
    };

    const handleRemoveFromQueue = async (id: string) => {
        try {
            const nextState = await removeQueueItem(roomId, id);
            if (!nextState) setPositionMs(0);
        } catch {
            toast.error('Failed to remove track from queue');
        }
    };

    const handlePlayFromQueue = async (id: string) => {
        setPositionMs(0);
        await playQueueItem(roomId, id);
    };

    const handlePlayNext = async () => {
        const nextState = await playNext(roomId);
        if (!nextState) setPositionMs(0);
    };

    const handleClearQueue = async () => {
        try {
            await clearQueue(roomId);
            setPositionMs(0);
        } catch {
            toast.error('Failed to clear queue');
        }
    };

    const handleShuffleQueue = async () => {
        await shuffleQueue(roomId);
    };

    const handleReorderQueue = async (items: PlaylistItem[]) => {
        await reorderQueue(roomId, items);
    };

    const isLoading = loading || resolving;
    const displayedSeekSeconds = isSeeking
        ? clampSeekSeconds(seekPreviewSeconds ?? Math.floor(positionMs / 1000))
        : (seekEnabled ? Math.min(Math.floor(positionMs / 1000), seekMax) : 0);

    return (
        <div className="flex flex-col gap-0">
            <div className={`
                rounded-lg border transition-all duration-200 overflow-hidden
                ${active ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-border bg-muted/30'}
            `}>
                <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Music2 className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-emerald-400' : 'text-muted-foreground'}`} />

                        {active ? (
                            <div className="flex items-center gap-2 min-w-0">
                                <Waveform active={!paused} />
                                <span className="text-xs text-emerald-400 truncate max-w-[140px]" title={currentTrack?.title ?? playing ?? ''}>
                                    {currentTrack?.title ?? (playing ? mediaLabel(playing) : 'Playing...')}
                                </span>
                                {activeVideoMode && (
                                    <span
                                        className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-sky-400 bg-sky-950/40 border border-sky-500/30 rounded px-1 py-0.5"
                                        title="Streaming video as screenshare"
                                    >
                                        <Cast className="h-2.5 w-2.5" />
                                        Video
                                    </span>
                                )}
                            </div>
                        ) : (
                            <span className="text-xs text-muted-foreground">Music Bot</span>
                        )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                        {active && (
                            <>
                                <Button
                                    data-testid="music-pause-resume"
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

                                {queue.length > 1 && (
                                    <Button
                                        data-testid="music-next"
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

                                <Button
                                    data-testid="music-stop"
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

                        {!botAvailable && (
                            <Button
                                data-testid="music-add-bot"
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs text-muted-foreground hover:text-foreground px-2"
                                onClick={async () => {
                                    await joinHub(hubId);
                                    setBotJoined(true);
                                    onBotJoined();
                                }}
                                disabled={isLoading}
                            >
                                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '+ Add bot'}
                            </Button>
                        )}
                    </div>
                </div>

                {active && (
                    <div className="flex items-center gap-2 px-3 pb-2">
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-10 text-right shrink-0">
                            {formatMs(positionMs)}
                        </span>
                        <input
                            data-testid="music-seek"
                            type="range"
                            min={0}
                            max={seekMax}
                            value={displayedSeekSeconds}
                            onChange={handleSeekChange}
                            onPointerDown={startSeekInteraction}
                            onPointerUp={() => { void commitSeek(); }}
                            onPointerCancel={cancelSeekInteraction}
                            onBlur={() => { void commitSeek(); }}
                            onKeyDown={handleSeekKeyDown}
                            onKeyUp={handleSeekKeyUp}
                            disabled={!seekEnabled}
                            className="flex-1 h-1 accent-emerald-400 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
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

            {botAvailable && (
                <div className="flex flex-col gap-1.5 mt-3">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Radio className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                data-testid="music-url-input"
                                ref={inputRef}
                                value={urlInput}
                                onChange={e => { setUrlInput(e.target.value); setInputError(null); }}
                                onKeyDown={handleKeyDown}
                                placeholder="YouTube or SoundCloud URL..."
                                className="h-8 text-xs pl-7 bg-background/50"
                            />
                        </div>

                        <button
                            data-testid="music-video-mode-toggle"
                            onClick={() => !active && setVideoMode(v => !v)}
                            disabled={active}
                            title={
                                active
                                    ? `Video screenshare is ${activeVideoMode ? 'on' : 'off'} for this session - stop the bot to change`
                                    : videoMode
                                        ? 'Video screenshare on - click to disable'
                                        : 'Video screenshare off - click to stream video as a screenshare'
                            }
                            className={`
                                shrink-0 h-8 w-8 flex items-center justify-center rounded-md border transition-all
                                ${active
                                    ? 'opacity-40 cursor-not-allowed border-border text-muted-foreground'
                                    : videoMode
                                        ? 'border-sky-500/60 bg-sky-950/30 text-sky-400 hover:bg-sky-950/50'
                                        : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80'
                                }
                            `}
                        >
                            <Cast className="h-3.5 w-3.5" />
                        </button>

                        <Button
                            data-testid="music-add-track"
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

                    {videoMode && !active && (
                        <p className="text-[11px] text-sky-400/80 flex items-center gap-1 px-1">
                            <Cast className="h-3 w-3 shrink-0" />
                            Video will stream as a screenshare when the bot joins
                        </p>
                    )}

                    {(inputError || error) && (
                        <p className="text-xs text-red-400 px-1">{inputError ?? error}</p>
                    )}
                </div>
            )}

            {queue.length > 0 && (
                <div className="mt-3">
                    <Separator className="mb-3" />

                    <div className="flex items-center gap-2 mb-2">
                        <button
                            data-testid="music-queue-toggle"
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
                        <button
                            data-testid="music-clear-queue"
                            onClick={handleClearQueue}
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
                            onReorder={handleReorderQueue}
                            onRemove={handleRemoveFromQueue}
                            onPlay={handlePlayFromQueue}
                            onShuffle={queue.length > 1 ? handleShuffleQueue : undefined}
                            onClear={handleClearQueue}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
