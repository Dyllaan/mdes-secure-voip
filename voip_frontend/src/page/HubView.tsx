import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useVoIPContext } from '@/components/providers/VoIPProvider';
import { useConnection } from '@/components/providers/ConnectionProvider';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { Channel } from '@/types/hub.types';
import HubSidebar from '@/components/hub/layout/HubSidebar';
import ChannelMessageArea from '@/components/hub/layout/ChannelMessageArea';
import EphemeralChatPanel from '@/components/hub/EphemeralChatPanel';
import useHubState from '@/hooks/hub/useHubState';
import { useEphemeralSession } from '@/hooks/hub/useEphemeralSession';
import HubLayoutContext from '@/contexts/HubLayoutContext';
import ActionsSidebar from '@/components/hub/layout/ActionsSidebar';
import { ScreenshareManager } from '@/components/room/screenshare/ScreenshareManager';

export default function HubView() {
    const { hubId, channelId } = useParams();
    const navigate = useNavigate();
    const { socket, isConnected } = useConnection();
    const {
        voiceChannel, joinVoiceChannel, remoteScreenStreams, localScreenStream, isSharing, startScreenShare, stopScreenShare, dismissScreenShare, dismissedPeerIds, restoreScreenShare,
    } = useVoIPContext();

    const { hub, channels, members, loading, error, isOwner, hasMusicman, refreshChannels, refreshMembers } = useHubState(hubId);
    const ephemSession = useEphemeralSession(hubId);

    const [screenshareVisible, setScreenshareVisible] = useState(true);
    const [ephemOpen, setEphemOpen] = useState(false);
    
    const onShowScreenshare = () => {
        setScreenshareVisible(true);
    };

    const hasScreens = remoteScreenStreams.length > 0 || (isSharing && !!localScreenStream);
    const totalStreams = remoteScreenStreams.length + (isSharing && localScreenStream ? 1 : 0);

    useEffect(() => {
        if (hasScreens) onShowScreenshare();
    }, [hasScreens]);
    

    const handleChannelClick = (channel: Channel) => {
        if (channel.type === 'voice') {
            joinVoiceChannel(hubId!, channel.id, channel.name);
        } else {
            navigate(`/hubs/${hubId}/channels/${channel.id}`);
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

    return (
        <HubLayoutContext.Provider value={{
            hub,
            channels,
            members,
            memberCount: members.length,
            isOwner,
            socket,
            hasMusicman,
            channelId,
            onNavigateBack: () => navigate('/'),
            onChannelClick: handleChannelClick,
            activeVoiceChannelId: voiceChannel?.channelId,
            hasScreens,
            totalStreams,
            refreshChannels,
            ephem: { ...ephemSession, open: ephemOpen, setOpen: setEphemOpen },
            isConnected,
            onBotJoined: refreshMembers,
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
                <HubSidebar />
                <div className="flex flex-col w-full">
                    {hasScreens && screenshareVisible && (
                        <ScreenshareManager onHide={() => setScreenshareVisible(false)} />
                    )}
                    <ChannelMessageArea />
                    <EphemeralChatPanel hubId={hubId} ephemOpen={ephemOpen} setEphemOpen={setEphemOpen} />
                </div>
                <ActionsSidebar
                    screenshareVisible={screenshareVisible}
                    onShowScreenshare={() => setScreenshareVisible(true)}
                />
            </div>
        </HubLayoutContext.Provider>
    );
}