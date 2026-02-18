import { useEffect, useState } from "react";
import useRoomManager from "../../hooks/useRoomManager";
import type { RoomInfo } from "../../hooks/useRoomManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar";
import {
    Trash2,
    RefreshCw,
    Users,
    LogOut,
    Plus,
    Wifi,
    WifiOff,
    Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SettingsDrawer from "@/page/SettingsSheet";
import { SimpleNoiseGate } from "@/utils/SimpleNoiseGate";

interface RoomManagerProps {
    currentRoomId: string | null;
    onJoinRoom: (roomId: string) => void;
    onLeaveRoom: () => void;
    isConnected: boolean;
    noiseGate: SimpleNoiseGate | null;
}

export default function RoomManager({
    currentRoomId,
    onJoinRoom,
    onLeaveRoom,
    isConnected,
    noiseGate,
}: RoomManagerProps) {
    const { rooms, loading, error, fetchRooms, createRoom, deleteRoom } =
        useRoomManager();
    const [customRoomId, setCustomRoomId] = useState("");
    const [creating, setCreating] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    useEffect(() => {
        fetchRooms();
    }, [fetchRooms]);

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

    return (
        <Sidebar collapsible="none">
            {/* ── Header ── */}
            <SidebarHeader className="border-b border-sidebar-border">
                <div className="flex items-center justify-between px-2 py-1">
                    <div className="flex items-center gap-2">
                        <Hash className="h-4 w-4 text-sidebar-foreground/50" />
                        <span className="text-sm font-semibold tracking-tight">Rooms</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {/* Connection pill */}
                        <span
                            className={cn(
                                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                                isConnected
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-muted text-muted-foreground"
                            )}
                        >
                            {isConnected ? (
                                <Wifi className="h-2.5 w-2.5" />
                            ) : (
                                <WifiOff className="h-2.5 w-2.5" />
                            )}
                            {isConnected ? "Connected" : "Offline"}
                        </span>

                        <button
                            onClick={fetchRooms}
                            disabled={loading}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-40"
                        >
                            <RefreshCw
                                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                            />
                        </button>
                    </div>
                </div>

                {/* Active room banner */}
                {currentRoomId && (
                    <div className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-950/40 px-3 py-2 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
                        <span className="flex-1 truncate font-mono text-emerald-300/80">
                            {currentRoomId}
                        </span>
                        <button
                            onClick={onLeaveRoom}
                            className="flex items-center gap-1 text-emerald-400/60 transition-colors hover:text-emerald-300"
                        >
                            <LogOut className="h-3 w-3" />
                        </button>
                    </div>
                )}

                {/* Create room */}
                <div className="mx-2 mb-2 flex gap-1.5">
                    <Input
                        placeholder="Room name…"
                        value={customRoomId}
                        onChange={(e) => setCustomRoomId(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
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
                    <Alert variant="destructive" className="mx-2 mb-2 py-2">
                        <AlertDescription className="text-xs">{error}</AlertDescription>
                    </Alert>
                )}
            </SidebarHeader>

            {/* ── Room list ── */}
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Available Rooms</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {rooms.length === 0 && !loading && (
                                <div className="flex flex-col items-center gap-1 py-10 text-center">
                                    <Hash className="h-6 w-6 text-sidebar-foreground/20" />
                                    <p className="text-xs text-sidebar-foreground/40">
                                        No rooms yet
                                    </p>
                                </div>
                            )}

                            {rooms.map((room) => (
                                <RoomRow
                                    key={room.id}
                                    room={room}
                                    isCurrentRoom={currentRoomId === room.id}
                                    isDeleting={deleteTarget === room.id}
                                    isConnected={isConnected}
                                    onJoin={() => onJoinRoom(room.id)}
                                    onDelete={() => handleDelete(room.id)}
                                />
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="border-t border-sidebar-border">
                <SettingsDrawer noiseGate={noiseGate} />
                </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}


interface RoomRowProps {
    room: RoomInfo;
    isCurrentRoom: boolean;
    isDeleting: boolean;
    isConnected: boolean;
    onJoin: () => void;
    onDelete: () => void;
}

function RoomRow({
    room,
    isCurrentRoom,
    isDeleting,
    isConnected,
    onJoin,
    onDelete,
}: RoomRowProps) {
    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                isActive={isCurrentRoom}
                disabled={isCurrentRoom || !isConnected}
                onClick={!isCurrentRoom && isConnected ? onJoin : undefined}
                className={cn(
                    "font-mono text-xs",
                    isCurrentRoom && "bg-emerald-950/50 text-emerald-300 hover:bg-emerald-950/50 hover:text-emerald-300"
                )}
                tooltip={room.id}
            >
                {/* Active dot */}
                <span
                    className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                        isCurrentRoom
                            ? "bg-emerald-400 shadow-[0_0_5px_theme(colors.emerald.400)]"
                            : "bg-sidebar-foreground/20"
                    )}
                />

                {/* Room name */}
                <span className="flex-1 truncate">{room.id}</span>

                {/* User count */}
                <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-sidebar-foreground/40">
                    <Users className="h-3 w-3" />
                    {room.userCount}
                </span>
            </SidebarMenuButton>

            {/* Delete action */}
            <SidebarMenuAction
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                disabled={isDeleting}
                title={isCurrentRoom ? "Leave & delete" : "Delete room"}
                className={cn(
                    isCurrentRoom
                        ? "text-emerald-400/50 hover:text-destructive"
                        : "text-sidebar-foreground/30 hover:text-destructive"
                )}
                showOnHover={!isCurrentRoom}
            >
                <Trash2 className="h-3 w-3" />
            </SidebarMenuAction>
        </SidebarMenuItem>
    );
}