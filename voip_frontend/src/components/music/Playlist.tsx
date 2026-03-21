import { useState, useRef, useCallback } from 'react';
import { GripVertical, Trash2, Shuffle, ListX, Music2, Clock, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface PlaylistItem {
    id: string;
    title: string;
    channel: string;
    duration: string; // e.g. "3:45"
    /** Optional — used to tint the index badge */
    source?: 'youtube' | 'spotify' | 'soundcloud';
}

interface PlaylistProps {
    items: PlaylistItem[];
    currentIndex?: number;
    onReorder: (items: PlaylistItem[]) => void;
    onRemove: (id: string) => void;
    onPlay: (id: string) => void;
    onShuffle?: () => void;
    onClear?: () => void;
    className?: string;
}

// ─── Drag state ───────────────────────────────────────────────────────────────

function parseDuration(d: string): number {
    const parts = d.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

function formatTotalDuration(items: PlaylistItem[]): string {
    const total = items.reduce((acc, i) => acc + parseDuration(i.duration), 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ─── Individual card ─────────────────────────────────────────────────────────

interface VideoRowProps {
    item: PlaylistItem;
    index: number;
    isActive: boolean;
    isDragging: boolean;
    isDropTarget: boolean;
    onRemove: () => void;
    onPlay: () => void;
    dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
}

function VideoRow({
    item,
    index,
    isActive,
    isDragging,
    isDropTarget,
    onRemove,
    onPlay,
    dragHandleProps,
}: VideoRowProps) {
    return (
        <div
            className={cn(
                'group relative flex items-center gap-2 rounded-lg px-2 py-2 transition-all duration-150 select-none',
                isActive
                    ? 'bg-primary/10 border border-primary/30'
                    : 'border border-transparent hover:bg-muted/60',
                isDragging && 'opacity-40 scale-[0.98]',
                isDropTarget && 'border-t-2 border-t-primary',
            )}
        >
            {/* Drag handle */}
            <div
                {...dragHandleProps}
                className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
                <GripVertical className="h-4 w-4" />
            </div>

            {/* Index / play indicator */}
            <div
                className={cn(
                    'shrink-0 w-6 h-6 flex items-center justify-center rounded text-xs font-mono transition-all',
                    isActive
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:opacity-0',
                )}
            >
                {isActive ? (
                    <Play className="h-3 w-3 fill-current" />
                ) : (
                    <span>{index + 1}</span>
                )}
            </div>

            {/* Play button — overlays index on hover */}
            {!isActive && (
                <button
                    onClick={onPlay}
                    className="absolute left-[2.35rem] w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-foreground hover:text-primary"
                    title="Play this track"
                >
                    <Play className="h-3 w-3 fill-current" />
                </button>
            )}

            {/* Title + channel */}
            <div className="flex-1 min-w-0">
                <p
                    className={cn(
                        'text-sm font-medium leading-snug truncate',
                        isActive ? 'text-primary' : 'text-foreground',
                    )}
                >
                    {item.title}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.channel}
                </p>
            </div>

            {/* Duration */}
            <span className="shrink-0 text-xs font-mono text-muted-foreground tabular-nums">
                {item.duration}
            </span>

            {/* Remove */}
            <button
                onClick={onRemove}
                className="shrink-0 p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                title="Remove"
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Playlist({
    items,
    currentIndex = -1,
    onReorder,
    onRemove,
    onPlay,
    onShuffle,
    onClear,
    className,
}: PlaylistProps) {
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const dragItem = useRef<number | null>(null);

    const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
        dragItem.current = index;
        setDragIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Invisible drag ghost
        const ghost = document.createElement('div');
        ghost.style.position = 'fixed';
        ghost.style.top = '-9999px';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        setTimeout(() => document.body.removeChild(ghost), 0);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragItem.current !== null && dragItem.current !== index) {
            setDropIndex(index);
        }
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent, index: number) => {
            e.preventDefault();
            const from = dragItem.current;
            if (from === null || from === index) return;
            const next = [...items];
            const [moved] = next.splice(from, 1);
            next.splice(index, 0, moved);
            onReorder(next);
            setDragIndex(null);
            setDropIndex(null);
            dragItem.current = null;
        },
        [items, onReorder],
    );

    const handleDragEnd = useCallback(() => {
        setDragIndex(null);
        setDropIndex(null);
        dragItem.current = null;
    }, []);

    if (items.length === 0) {
        return (
            <div
                className={cn(
                    'flex flex-col items-center justify-center gap-3 py-12 text-center',
                    className,
                )}
            >
                <div className="rounded-full bg-muted p-3">
                    <Music2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                    <p className="text-sm font-medium text-foreground">Queue is empty</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Add a track with <code className="font-mono bg-muted px-1 rounded">!play</code>
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={cn('flex flex-col gap-1', className)}>
            {/* Header bar */}
            <div className="flex items-center justify-between pb-1 mb-1 border-b">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="font-mono text-xs px-1.5 py-0">
                        {items.length}
                    </Badge>
                    <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTotalDuration(items)}
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    {onShuffle && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1.5"
                            onClick={onShuffle}
                        >
                            <Shuffle className="h-3 w-3" />
                            Shuffle
                        </Button>
                    )}
                    {onClear && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={onClear}
                        >
                            <ListX className="h-3 w-3" />
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            {/* Track list */}
            <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[60vh] pr-0.5">
                {items.map((item, index) => (
                    <div
                        key={item.id}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                    >
                        <VideoRow
                            item={item}
                            index={index}
                            isActive={index === currentIndex}
                            isDragging={dragIndex === index}
                            isDropTarget={dropIndex === index && dragIndex !== index}
                            onRemove={() => onRemove(item.id)}
                            onPlay={() => onPlay(item.id)}
                            dragHandleProps={{
                                draggable: true,
                                onDragStart: (e) => handleDragStart(e as React.DragEvent, index),
                                onDragEnd: handleDragEnd,
                            }}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}