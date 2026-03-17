import { useEffect, useState, useRef, useCallback } from "react";
import useRoomManager from "@/hooks/realtime/useRoomManager";
import type { Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Hash, LogOut, Plus, RefreshCw, Settings, Wifi, WifiOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import RoomRow from "./RoomRow";
import { useIsMobile } from "@/hooks/use-mobile";

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;

interface RoomManagerProps {
    socket: Socket | null;
    currentRoomId: string | null;
    onJoinRoom: (roomId: string) => void;
    onLeaveRoom: () => void;
    isConnected: boolean;
    onOpenSettings: () => void;
    mobileOpen?: boolean;
    onMobileClose?: () => void;
}

export default function RoomManager({
    socket,
    currentRoomId,
    onJoinRoom,
    onLeaveRoom,
    isConnected,
    onOpenSettings,
    mobileOpen = false,
    onMobileClose,
}: RoomManagerProps) {
    const { rooms, loading, error, fetchRooms, createRoom, deleteRoom } = useRoomManager(socket);
    const [customRoomId, setCustomRoomId] = useState("");
    const [creating, setCreating] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const isMobile = useIsMobile();

    // desktop only
    const [width, setWidth] = useState(DEFAULT_WIDTH);
    const isResizing = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(DEFAULT_WIDTH);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        isResizing.current = true;
        startX.current = e.clientX;
        startWidth.current = width;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    }, [width]);

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!isResizing.current) return;
            const delta = e.clientX - startX.current;
            const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
            setWidth(next);
        };
        const onMouseUp = () => {
            if (!isResizing.current) return;
            isResizing.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, []);

    const handleCreate = async () => {
        setCreating(true);
        const room = await createRoom(customRoomId.trim() || undefined);
        setCreating(false);
        if (room) setCustomRoomId("");
    };

    const handleDelete = async (roomId: string) => {
        setDeleteTarget(roomId);
        await deleteRoom(roomId);
        setDeleteTarget(null);
        if (currentRoomId === roomId) onLeaveRoom();
    };

    const handleJoinRoom = (roomId: string) => {
        onJoinRoom(roomId);
        // Auto-close drawer on mobile after joining
        onMobileClose?.();
    };

    const panelContent = (
        <div className="flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
                <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-sidebar-foreground/50" />
                    <span className="text-sm font-semibold tracking-tight">Rooms</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span
                        className={cn(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                            isConnected
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-muted text-muted-foreground"
                        )}
                    >
                        {isConnected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                        {isConnected ? "Live" : "Offline"}
                    </span>
                    <button
                        onClick={fetchRooms}
                        disabled={loading}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                    </button>
                    {/* Close button - mobile only */}
                    {isMobile && (
                        <button
                            onClick={onMobileClose}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Current room banner */}
            {currentRoomId && (
                <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-950/40 px-3 py-2 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
                    <span className="flex-1 truncate font-mono text-emerald-300/80">{currentRoomId}</span>
                    <button
                        onClick={onLeaveRoom}
                        className="flex items-center gap-1 text-emerald-400/60 transition-colors hover:text-emerald-300"
                    >
                        <LogOut className="h-3 w-3" />
                    </button>
                </div>
            )}

            {/* Create room */}
            <div className="px-3 pt-3">
                <div className="flex gap-1.5">
                    <Input
                        placeholder="Room name…"
                        value={customRoomId}
                        onChange={e => setCustomRoomId(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleCreate()}
                        maxLength={32}
                        disabled={!isConnected}
                        className="h-8 flex-1 bg-sidebar-accent/50 font-mono text-xs placeholder:text-sidebar-foreground/30 focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                    />
                    <Button
                        onClick={handleCreate}
                        disabled={creating || loading || !isConnected}
                        size="sm"
                        className="h-8 gap-1 px-3 text-xs"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        {creating ? "…" : "New"}
                    </Button>
                </div>

                {error && (
                    <Alert variant="destructive" className="mt-2 py-2">
                        <AlertDescription className="text-xs">{error}</AlertDescription>
                    </Alert>
                )}
            </div>

            <Separator className="mx-3 mt-3 w-auto bg-sidebar-border/60" />

            {/* Room list */}
            <ScrollArea className="flex-1 px-3 py-2 w-full">
                <div className="space-y-1 w-full">
                    {rooms.length === 0 && !loading && (
                        <div className="flex flex-col items-center gap-1 py-10 text-center">
                            <Hash className="h-6 w-6 text-sidebar-foreground/20" />
                            <p className="text-xs text-sidebar-foreground/40">No rooms yet</p>
                        </div>
                    )}
                    {rooms.map(room => (
                        <RoomRow
                            key={room.id}
                            room={room}
                            isCurrentRoom={currentRoomId === room.id}
                            isDeleting={deleteTarget === room.id}
                            isConnected={isConnected}
                            onJoin={() => handleJoinRoom(room.id)}
                            onDelete={() => handleDelete(room.id)}
                        />
                    ))}
                </div>
            </ScrollArea>

            {/* Footer */}
            <div className="border-t border-sidebar-border p-3 space-y-2">
                {!isConnected && (
                    <p className="text-[11px] text-sidebar-foreground/40 px-1">Connect to manage rooms.</p>
                )}
                 <button
                    onClick={onOpenSettings}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group"
                >
                    <Settings className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:rotate-45" />
                    <span className="text-xs font-medium">Settings</span>
                </button>
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <>
                {/* Backdrop */}
                <div
                    className={cn(
                        "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
                        mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                    )}
                    onClick={onMobileClose}
                />
                {/* Drawer panel */}
                <div
                    className={cn(
                        "fixed inset-y-0 left-0 z-50 w-72 shadow-2xl transition-transform duration-300 ease-in-out",
                        mobileOpen ? "translate-x-0" : "-translate-x-full"
                    )}
                >
                    {panelContent}
                </div>
            </>
        );
    }

    return (
        <div
            className="relative flex h-full shrink-0 flex-col"
            style={{ width }}
        >
            <div className="flex h-full flex-col overflow-hidden rounded-none border-r border-sidebar-border">
                {panelContent}
            </div>

            {/* Drag handle */}
            <div
                onMouseDown={onMouseDown}
                className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize group"
            >
                <div className="absolute right-0 top-0 h-full w-1 bg-transparent transition-colors duration-150 group-hover:bg-primary/40 group-active:bg-primary/60" />
                <div className="absolute right-0 top-1/2 -translate-y-1/2 h-8 w-1 rounded-full opacity-0 group-hover:opacity-100 bg-primary/30 transition-opacity duration-200 blur-[1px]" />
            </div>
        </div>
    );
}