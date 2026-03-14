import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import VoicePanel from '@/components/voip/VoicePanel';
import { ArrowLeft, Hash, Plus, Users, MessageSquare, Volume2 } from 'lucide-react';
import type { Server, Channel } from '@/types/server.types';
import type { UseEphemeralChatReturn } from '@/hooks/useEphemeralChat';

interface ChannelSidebarProps {
    server: Server | null;
    channels: Channel[];
    memberCount: number;
    isOwner: boolean;
    channelId: string | undefined;
    activeVoiceChannelId: string | null | undefined;
    inviteCode: string | null;
    newChannelName: string;
    newChannelType: 'text' | 'voice';
    isConnected: boolean;
    ephem: UseEphemeralChatReturn;
    onNavigateBack: () => void;
    onChannelClick: (channel: Channel) => void;
    onCreateChannel: () => void;
    onCreateInvite: () => void;
    onNewChannelNameChange: (name: string) => void;
    onNewChannelTypeToggle: () => void;
}

export default function ChannelSidebar({
    server,
    channels,
    memberCount,
    isOwner,
    channelId,
    activeVoiceChannelId,
    inviteCode,
    newChannelName,
    newChannelType,
    isConnected,
    ephem,
    onNavigateBack,
    onChannelClick,
    onCreateChannel,
    onCreateInvite,
    onNewChannelNameChange,
    onNewChannelTypeToggle,
}: ChannelSidebarProps) {
    return (
        <div className="w-60 border-r flex flex-col bg-muted/30">
            {/* Server header */}
            <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold truncate">{server?.name}</h2>
                    <Button variant="ghost" size="icon" onClick={onNavigateBack}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </div>
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="mt-2">
                    {inviteCode ? (
                        <div className="flex items-center gap-2">
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1">
                                {inviteCode}
                            </code>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => navigator.clipboard.writeText(inviteCode)}
                            >
                                Copy
                            </Button>
                        </div>
                    ) : (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="w-full text-xs text-muted-foreground"
                            onClick={onCreateInvite}
                        >
                            Generate invite code
                        </Button>
                    )}
                </div>
            </div>

            {/* New channel creation (owner only) */}
            {isOwner && (
                <div className="p-3 border-b">
                    <div className="flex gap-1">
                        <Input
                            placeholder="New channel..."
                            value={newChannelName}
                            onChange={(e) => onNewChannelNameChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && onCreateChannel()}
                            className="h-8 text-xs"
                        />
                        <button
                            onClick={onNewChannelTypeToggle}
                            className="h-8 px-2 rounded-md border text-muted-foreground hover:text-foreground transition-colors"
                            title={`Type: ${newChannelType}`}
                        >
                            {newChannelType === 'text'
                                ? <Hash className="h-3 w-3" />
                                : <Volume2 className="h-3 w-3" />
                            }
                        </button>
                        <Button
                            size="sm"
                            className="h-8 px-2"
                            onClick={onCreateChannel}
                            disabled={!newChannelName.trim()}
                        >
                            <Plus className="h-3 w-3" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Channel list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {channels.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No channels yet</p>
                ) : (
                    channels.map((channel) => (
                        <button
                            key={channel.id}
                            onClick={() => onChannelClick(channel)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                                (channel.type === 'voice'
                                    ? activeVoiceChannelId === channel.id
                                    : channelId === channel.id)
                                    ? 'bg-accent text-accent-foreground'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}
                        >
                            {channel.type === 'voice'
                                ? <Volume2 className="h-4 w-4 shrink-0" />
                                : <Hash className="h-4 w-4 shrink-0" />
                            }
                            <span className="truncate">{channel.name}</span>
                        </button>
                    ))
                )}
            </div>

            {/* Voice panel */}
            <VoicePanel />

            {/* Ephemeral chat controls */}
            <div className="p-3 border-t space-y-2">
                {ephem.active ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-muted-foreground">Ephemeral chat active</span>
                            {ephem.timeLeft && (
                                <span className="ml-auto font-mono text-[11px] text-amber-400/70">
                                    {ephem.timeLeft}
                                </span>
                            )}
                        </div>
                        {!ephem.joined ? (
                            <Button
                                size="sm"
                                className="w-full gap-2"
                                onClick={ephem.handleJoin}
                                disabled={!isConnected}
                            >
                                <MessageSquare className="h-3.5 w-3.5" />
                                Join chat
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                className="w-full gap-2"
                                onClick={() => ephem.setOpen(true)}
                            >
                                <MessageSquare className="h-3.5 w-3.5" />
                                Open chat
                            </Button>
                        )}
                        {ephem.joined && (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="w-full text-xs text-destructive hover:text-destructive"
                                onClick={ephem.handleEnd}
                            >
                                End ephemeral chat
                            </Button>
                        )}
                    </div>
                ) : (
                    <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-2"
                        onClick={ephem.handleStart}
                        disabled={!isConnected}
                    >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Start ephemeral chat
                    </Button>
                )}
            </div>
        </div>
    );
}
