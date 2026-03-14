import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useVoIPContext } from '@/components/providers/VoIPProvider';
import { useServerAPI } from '@/hooks/useServer';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/components/providers/ConnectionProvider';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { Channel } from '@/types/server.types';
import ChannelSidebar from '@/components/server/ChannelSidebar';
import ChannelMessageArea from '@/components/server/ChannelMessageArea';
import EphemeralChatPanel from '@/components/server/EphemeralChatPanel';
import { useServerData } from '@/hooks/useServerData';
import { useEphemeralChat } from '@/hooks/useEphemeralChat';
import { useChannelMessages } from '@/hooks/useChannelMessages';

export default function ServerView() {
    const { serverId, channelId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { isConnected } = useConnection();
    const { createChannel, createInvite } = useServerAPI();
    const { voiceChannel, joinVoiceChannel } = useVoIPContext();

    const { server, channels, members, loading, error, isOwner, refreshChannels } = useServerData(serverId);
    const { messages, hasMore, decryptedMessages, loadOlderMessages, sendMessage: sendChannelMessage } = useChannelMessages(serverId, channelId);
    const ephem = useEphemeralChat(serverId);

    const [messageInput, setMessageInput] = useState('');
    const [newChannelName, setNewChannelName] = useState('');
    const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
    const [inviteCode, setInviteCode] = useState<string | null>(null);

    const handleChannelClick = (channel: Channel) => {
        if (channel.type === 'voice') {
            joinVoiceChannel(serverId!, channel.id, channel.name);
        } else {
            navigate(`/servers/${serverId}/channels/${channel.id}`);
        }
    };

    const handleCreateChannel = async () => {
        if (!serverId || !newChannelName.trim()) return;
        try {
            await createChannel(serverId, newChannelName.trim(), newChannelType);
            setNewChannelName('');
            setNewChannelType('text');
            await refreshChannels();
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
        if (!serverId) return;
        try {
            const data = await createInvite(serverId);
            setInviteCode(data.code);
        } catch (err) {
            console.error('Failed to create invite:', err);
        }
    };

    if (loading) {
        return (
            <div className="h-screen flex items-center justify-center">
                <p className="text-muted-foreground">Loading server...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-screen flex flex-col items-center justify-center gap-4">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={() => navigate('/')}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to servers
                </Button>
            </div>
        );
    }

    // undefined → show "select a channel" placeholder; string → show message area
    const channelName = channelId
        ? (channels.find(c => c.id === channelId)?.name ?? 'Unknown channel')
        : undefined;

    return (
        <div className="h-screen flex relative">
            <ChannelSidebar
                server={server}
                channels={channels}
                memberCount={members.length}
                isOwner={isOwner}
                channelId={channelId}
                activeVoiceChannelId={voiceChannel?.channelId}
                inviteCode={inviteCode}
                newChannelName={newChannelName}
                newChannelType={newChannelType}
                isConnected={isConnected}
                ephem={ephem}
                onNavigateBack={() => navigate('/')}
                onChannelClick={handleChannelClick}
                onCreateChannel={handleCreateChannel}
                onCreateInvite={handleCreateInvite}
                onNewChannelNameChange={setNewChannelName}
                onNewChannelTypeToggle={() => setNewChannelType(t => t === 'text' ? 'voice' : 'text')}
            />

            <ChannelMessageArea
                channelName={channelName}
                messages={messages}
                decryptedMessages={decryptedMessages}
                hasMore={hasMore}
                messageInput={messageInput}
                userId={user?.sub}
                onLoadOlder={loadOlderMessages}
                onInputChange={setMessageInput}
                onSend={handleSendMessage}
            />

            <EphemeralChatPanel
                joined={ephem.joined}
                open={ephem.open}
                messages={ephem.messages}
                input={ephem.input}
                timeLeft={ephem.timeLeft}
                onToggle={() => ephem.setOpen(!ephem.open)}
                onLeave={ephem.handleLeave}
                onSend={ephem.handleSend}
                onInputChange={ephem.setInput}
            />
        </div>
    );
}
