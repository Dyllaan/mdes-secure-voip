import type { RoomInfo } from "../../hooks/useRoomManager";
import {
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
    Trash2,
    Users,
    LogIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Button } from "../ui/button";

interface RoomRowProps {
    room: RoomInfo;
    isCurrentRoom: boolean;
    isDeleting: boolean;
    isConnected: boolean;
    onJoin: () => void;
    onDelete: () => void;
}

export default function RoomRow({
    room,
    isCurrentRoom,
    isDeleting,
    isConnected,
    onJoin,
    onDelete,
}: RoomRowProps) {
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                    <Button
                        disabled={isCurrentRoom || !isConnected}
                        onClick={!isCurrentRoom && isConnected ? onJoin : undefined}
                        className={cn(
                            "font-mono text-xs w-full",
                            isCurrentRoom && "bg-emerald-950/50 text-emerald-300 hover:bg-emerald-950/50 hover:text-emerald-300",
                            !isCurrentRoom && "hover:bg-accent hover:text-foreground"
                        )}
                    >
                        <span
                            className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                                isCurrentRoom
                                    ? "bg-emerald-400 shadow-[0_0_5px_theme(colors.emerald.400)]"
                                    : "bg-sidebar-foreground/20"
                            )}
                        />
                        <span className="flex-1 truncate">{room.id}</span>
                        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-sidebar-foreground/40">
                            <Users className="h-3 w-3" />
                            {room.userCount}
                        </span>
                    </Button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
                <ContextMenuItem
                    onClick={onJoin}
                    disabled={isCurrentRoom || !isConnected}
                    className="gap-2"
                >
                    <LogIn className="h-4 w-4" />
                    Join room
                </ContextMenuItem>
                <ContextMenuItem
                    onClick={onDelete}
                    disabled={isDeleting}
                    className="gap-2 text-destructive focus:text-destructive"
                >
                    <Trash2 className="h-4 w-4" />
                    {isCurrentRoom ? "Leave & delete" : "Delete room"}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}