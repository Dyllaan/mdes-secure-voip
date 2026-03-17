import { createContext, useContext } from 'react';
import type { Hub, Channel, EncryptedMessage, Member } from '@/types/hub.types';
import type { UseEphemeralChatReturn } from '@/hooks/hub/useEphemeralChat';

interface HubLayoutContextValue {
    hub: Hub | null;
    channels: Channel[];
    memberCount: number;
    members: Member[];
    isOwner: boolean;
    hasMusicman: boolean;
    hubId: string | undefined;
    channelId: string | undefined;
    channelName: string | undefined;
    onNavigateBack: () => void;
    onChannelClick: (channel: Channel) => void;
    activeVoiceChannelId: string | null | undefined;
    inviteCode: string | null;
    onCreateInvite: () => void;
    newChannelName: string;
    newChannelType: 'text' | 'voice';
    onNewChannelNameChange: (name: string) => void;
    onNewChannelTypeToggle: () => void;
    onCreateChannel: () => void;
    messages: EncryptedMessage[];
    decryptedMessages: Record<string, string | null>;
    hasMore: boolean;
    messageInput: string;
    userId: string | undefined;
    onLoadOlder: () => void;
    onInputChange: (value: string) => void;
    onSend: () => void;
    ephem: UseEphemeralChatReturn;
    isConnected: boolean;
    onBotJoined: () => void;
    kickMember: (memberId: string) => void;
}

const HubLayoutContext = createContext<HubLayoutContextValue | null>(null);

export function useHubLayout() {
    const ctx = useContext(HubLayoutContext);
    if (!ctx) throw new Error('useHubLayout must be used within HubLayoutContext.Provider');
    return ctx;
}

export default HubLayoutContext;