import { createContext, useContext } from 'react';
import type { Hub, Channel, Member } from '@/types/hub.types';
import type { EphemeralSession } from '@/hooks/hub/useEphemeralSession';
import type { Socket } from 'socket.io-client';

interface EphemeralContextSlice extends EphemeralSession {
    open: boolean;
    setOpen: (v: boolean) => void;
}

interface HubLayoutContextValue {
    hub: Hub | null;
    channels: Channel[];
    memberCount: number;
    members: Member[];
    isOwner: boolean;
    hasMusicman: boolean;
    channelId: string | undefined;
    onNavigateBack: () => void;
    onChannelClick: (channel: Channel) => void;
    activeVoiceChannelId: string | null | undefined;
    socket: Socket | null;
    refreshChannels: () => Promise<void>;
    ephem: EphemeralContextSlice;
    isConnected: boolean;
    onBotJoined: () => void;
    remoteScreenStreams: Array<{ peerId: string; stream: MediaStream; alias: string }>;
    localScreenStream: MediaStream | null;
    isSharing: boolean;
    startScreenShare: () => void;
    stopScreenShare: () => void;
    dismissScreenShare: (peerId: string) => void;
    dismissedPeerIds: Set<string>;
    restoreScreenShare: (peerId: string) => void;
    hasScreens: boolean;
    totalStreams: number;
}

const HubLayoutContext = createContext<HubLayoutContextValue | null>(null);

export function useHubLayout() {
    const ctx = useContext(HubLayoutContext);
    if (!ctx) throw new Error('useHubLayout must be used within HubLayoutContext.Provider');
    return ctx;
}

export default HubLayoutContext;