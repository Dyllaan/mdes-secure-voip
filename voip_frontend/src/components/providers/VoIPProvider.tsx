import { createContext, useContext, useCallback, useState } from "react";
import type { ReactNode } from "react";
import useVoIP from "@/hooks/realtime/useVoIP";
import type { ChatMessage, RemoteStream } from "@/types/voip.types";
import type { RoomInfo } from "@/hooks/realtime/useRoomManager";
import type { Socket } from "socket.io-client";

interface VoiceChannelInfo {
  serverId: string;
  channelId: string;
  channelName: string;
}

interface VoIPContextValue {
  voiceChannel: VoiceChannelInfo | null;
  joinVoiceChannel: (serverId: string, channelId: string, channelName: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  isVoiceActive: boolean;
  myPeerId: string;
  remoteStreams: RemoteStream[];
  connectedPeers: Array<{ peerId: string; alias: string }>;
  isEncryptionReady: boolean;
  isConnected: boolean;
  isAuthenticated: boolean;
  currentRoomId: string | null;
  socket: Socket | null;
  user: ReturnType<typeof useVoIP>["user"];
  chatMessages: ChatMessage[];
  message: string;
  setMessage: (msg: string) => void;
  sendMessage: () => Promise<void>;
  isSharing: boolean;
  localScreenStream: MediaStream | null;
  remoteScreenStreams: Array<{ peerId: string; stream: MediaStream; alias: string }>;
  startScreenShare: () => void;
  stopScreenShare: () => void;
  dismissScreenShare: (peerId: string) => void;
  roomList: RoomInfo[];
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => void;
  dismissedPeerIds: Set<string>;
  restoreScreenShare: (peerId: string) => void;
  muted: boolean;
  toggleMute: () => void;
  peerVolumes: Record<string, number>;
  setPeerVolume: (peerId: string, volume: number) => void;
  saveVolumeForAlias: (alias: string, volume: number) => void;
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
    if (voiceChannel) voip.leaveRoom();
    await voip.joinRoom(channelId);
    setVoiceChannel({ serverId, channelId, channelName });
  }, [voip.joinRoom, voip.leaveRoom, voiceChannel]);

  const leaveVoiceChannel = useCallback(() => {
    voip.leaveRoom();
    setVoiceChannel(null);
  }, [voip.leaveRoom]);

  const value: VoIPContextValue = {
    voiceChannel,
    joinVoiceChannel,
    leaveVoiceChannel,
    isVoiceActive: voip.isVoiceActive,
    myPeerId: voip.myPeerId,
    remoteStreams: voip.remoteStreams,
    connectedPeers: voip.connectedPeers,
    isEncryptionReady: voip.isEncryptionReady,
    isConnected: voip.isConnected,
    isAuthenticated: voip.isAuthenticated,
    currentRoomId: voip.currentRoomId,
    socket: voip.socket,
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
    dismissedPeerIds: voip.dismissedPeerIds,
    restoreScreenShare: voip.restoreScreenShare,
    muted: voip.muted,
    toggleMute: voip.toggleMute,
    peerVolumes: voip.peerVolumes,
    setPeerVolume: voip.setPeerVolume,
    saveVolumeForAlias: voip.saveVolumeForAlias,
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