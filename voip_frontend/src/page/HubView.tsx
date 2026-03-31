import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useVoIPContext } from '@/components/providers/VoIPProvider';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/components/providers/ConnectionProvider';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { Channel } from '@/types/hub.types';
import ChannelSidebar from '@/components/hub/ChannelSidebar';
import ChannelMessageArea from '@/components/hub/ChannelMessageArea';
import EphemeralChatPanel from '@/components/hub/EphemeralChatPanel';
import useHubData from '@/hooks/hub/useHubData';
import { useEphemeralChat } from '@/hooks/hub/useEphemeralChat';
import { useChannelMessages } from '@/hooks/hub/useChannelMessages';
import useHubAPI from '@/hooks/hub/useHubAPI';
import HubLayoutContext from '@/contexts/HubLayoutContext';
import ActionsSidebar from '@/components/hub/ActionsSidebar';
import { ScreenshareManager } from '@/components/room/screenshare/ScreenshareManager';

export default function HubView() {
    const { hubId, channelId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { socket, isConnected } = useConnection();
    const { createChannel, createInvite } = useHubAPI();
    const {
        voiceChannel, joinVoiceChannel,
        remoteScreenStreams, localScreenStream, isSharing,
        startScreenShare, stopScreenShare, dismissScreenShare,
        dismissedPeerIds, restoreScreenShare,
    } = useVoIPContext();

    const { hub, channels, members, loading, error, isOwner, refreshChannels, hasMusicman, refreshMembers, kickMember } = useHubData(hubId);
    const { messages, hasMore, decryptedMessages, loadOlderMessages, sendMessage: sendChannelMessage } = useChannelMessages(hubId, channelId);
    const ephem = useEphemeralChat(hubId);

    const [messageInput, setMessageInput] = useState('');
    const [newChannelName, setNewChannelName] = useState('');
    const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    const [screenshareVisible, setScreenshareVisible] = useState(true);

    // Any streams exist at all (including dismissed ones - they're still live)
    const hasScreens = remoteScreenStreams.length > 0 || (isSharing && !!localScreenStream);

    // Auto-open panel when new streams arrive
    useEffect(() => {
        if (hasScreens) setScreenshareVisible(true);
    }, [hasScreens]);

    const handleChannelClick = (channel: Channel) => {
        if (channel.type === 'voice') {
            joinVoiceChannel(hubId!, channel.id, channel.name);
        } else {
            navigate(`/hubs/${hubId}/channels/${channel.id}`);
        }
    };

    const handleCreateChannel = async () => {
        if (!hubId || !newChannelName.trim()) return;
        try {
            const created = await createChannel(hubId, newChannelName.trim(), newChannelType);
            setNewChannelName('');
            setNewChannelType('text');
            await refreshChannels();
            if (created?.id) {
                socket?.emit('channel-created', { hubId, channelId: created.id });
            }
        } catch (err) {
            console.error('Failed to create channel:', err);
        }
    };

    const handleSendMessage = async () => {
        if (!messageInput.trim()) return;
        const text = messageInput.trim();
        setMessageInput('');
        try {
            await sendChannelMessage(text);
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };

    const handleCreateInvite = async () => {
        if (!hubId) return;
        try {
            const data = await createInvite(hubId);
            setInviteCode(data.code);
        } catch (err) {
            console.error('Failed to create invite:', err);
        }
    };

    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center">
                <p className="text-muted-foreground">Loading hub...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-screen flex flex-col items-center justify-center gap-4">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={() => navigate('/')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to hubs
                </Button>
            </div>
        );
    }

    const channelName = channelId
        ? (channels.find(c => c.id === channelId)?.name ?? 'Unknown channel')
        : undefined;

    return (
        <HubLayoutContext.Provider value={{
            hub,
            channels,
            members,
            memberCount: members.length,
            isOwner,
            hasMusicman,
            hubId,
            channelId,
            channelName,
            onNavigateBack: () => navigate('/'),
            onChannelClick: handleChannelClick,
            activeVoiceChannelId: voiceChannel?.channelId,
            inviteCode,
            onCreateInvite: handleCreateInvite,
            newChannelName,
            newChannelType,
            onNewChannelNameChange: setNewChannelName,
            onNewChannelTypeToggle: () => setNewChannelType(t => t === 'text' ? 'voice' : 'text'),
            onCreateChannel: handleCreateChannel,
            messages,
            decryptedMessages,
            hasMore,
            messageInput,
            userId: user?.sub,
            onLoadOlder: loadOlderMessages,
            onInputChange: setMessageInput,
            onSend: handleSendMessage,
            ephem,
            isConnected,
            onBotJoined: refreshMembers, kickMember,
            remoteScreenStreams,
            localScreenStream,
            isSharing,
            startScreenShare,
            stopScreenShare,
            dismissScreenShare,
            dismissedPeerIds,
            restoreScreenShare,
        }}>
            <div className="h-screen flex relative">
                <ChannelSidebar />
                <div className="flex flex-col w-full">
                    {hasScreens && screenshareVisible && (
                        <ScreenshareManager onHide={() => setScreenshareVisible(false)} />
                    )}
                    <ChannelMessageArea />
                    <EphemeralChatPanel />
                </div>
                <ActionsSidebar
                    screenshareVisible={screenshareVisible}
                    onShowScreenshare={() => setScreenshareVisible(true)}
                />
            </div>
        </HubLayoutContext.Provider>
    );
}