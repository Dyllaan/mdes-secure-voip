import { createContext, useContext, useCallback, useState } from "react";
import type { ReactNode } from "react";
import useVoIP from "@/hooks/useVoIP";
import type { ChatMessage, RemoteStream } from "@/hooks/useVoIP";
import type { RoomInfo } from "@/hooks/useRoomManager";
import type { SimpleNoiseGate } from "@/utils/SimpleNoiseGate";
import type { Socket } from "socket.io-client";
import type { SignalProtocolClient } from "@/utils/SignalProtocolClient";

interface VoiceChannelInfo {
    serverId: string;
    channelId: string;
    channelName: string;
}

interface VoIPContextValue {
    // Voice channel state
    voiceChannel: VoiceChannelInfo | null;
    joinVoiceChannel: (serverId: string, channelId: string, channelName: string) => Promise<void>;
    leaveVoiceChannel: () => void;
    isVoiceActive: boolean;

    // Passthrough from useVoIP
    myPeerId: string;
    remoteStreams: RemoteStream[];
    connectedPeers: Array<{ peerId: string; alias: string }>;
    isEncryptionReady: boolean;
    isConnected: boolean;
    isAuthenticated: boolean;
    currentRoomId: string | null;
    socket: Socket | null;
    noiseGate: SimpleNoiseGate | null;
    signalClient: SignalProtocolClient | null;
    user: ReturnType<typeof useVoIP>["user"];

    // Chat (for ephemeral VoIP page — kept for backward compat)
    chatMessages: ChatMessage[];
    message: string;
    setMessage: (msg: string) => void;
    sendMessage: () => Promise<void>;

    // Screen sharing
    isSharing: boolean;
    localScreenStream: MediaStream | null;
    remoteScreenStreams: Array<{ peerId: string; stream: MediaStream; alias: string }>;
    startScreenShare: () => void;
    stopScreenShare: () => void;
    dismissScreenShare: (peerId: string) => void;

    // Room list (for ephemeral VoIP page)
    roomList: RoomInfo[];
    joinRoom: (roomId: string) => Promise<void>;
    leaveRoom: () => void;

    // Audio ref
    localAudioRef: React.RefObject<HTMLAudioElement | null>;
}

const VoIPContext = createContext<VoIPContextValue | null>(null);

export function VoIPProvider({ children }: { children: ReactNode }) {
    const voip = useVoIP();
    const [voiceChannel, setVoiceChannel] = useState<VoiceChannelInfo | null>(null);

    const joinVoiceChannel = useCallback(async (
        serverId: string,
        channelId: string,
        channelName: string,
    ) => {
        // If already in a voice channel, leave it first
        if (voiceChannel) {
            voip.leaveRoom();
        }

        // Use a deterministic room ID so all users in the same channel join the same room
        const roomId = `vc-${channelId}`;
        await voip.joinRoom(roomId);

        setVoiceChannel({ serverId, channelId, channelName });
    }, [voip.joinRoom, voip.leaveRoom, voiceChannel]);

    const leaveVoiceChannel = useCallback(() => {
        voip.leaveRoom();
        setVoiceChannel(null);
    }, [voip.leaveRoom]);

    const value: VoIPContextValue = {
        // Voice channel state
        voiceChannel,
        joinVoiceChannel,
        leaveVoiceChannel,
        isVoiceActive: voip.isVoiceActive,

        // Passthrough
        myPeerId: voip.myPeerId,
        remoteStreams: voip.remoteStreams,
        connectedPeers: voip.connectedPeers,
        isEncryptionReady: voip.isEncryptionReady,
        isConnected: voip.isConnected,
        isAuthenticated: voip.isAuthenticated,
        currentRoomId: voip.currentRoomId,
        socket: voip.socket,
        noiseGate: voip.noiseGate,
        signalClient: voip.signalClient,
        user: voip.user,

        chatMessages: voip.chatMessages,
        message: voip.message,
        setMessage: voip.setMessage,
        sendMessage: voip.sendMessage,

        isSharing: voip.isSharing,
        localScreenStream: voip.localScreenStream,
        remoteScreenStreams: voip.remoteScreenStreams,
        startScreenShare: voip.startScreenShare,
        stopScreenShare: voip.stopScreenShare,
        dismissScreenShare: voip.dismissScreenShare,

        roomList: voip.roomList,
        joinRoom: voip.joinRoom,
        leaveRoom: voip.leaveRoom,

        localAudioRef: voip.localAudioRef,
    };

    return (
        <VoIPContext.Provider value={value}>
            {children}
        </VoIPContext.Provider>
    );
}

export function useVoIPContext() {
    const context = useContext(VoIPContext);
    if (!context) {
        throw new Error("useVoIPContext must be used within a VoIPProvider");
    }
    return context;
}