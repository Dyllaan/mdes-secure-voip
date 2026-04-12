import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/auth/useAuth";

import { useConnection } from "@/components/providers/ConnectionProvider";
import type { DecryptedRoomMessage } from "@/utils/RoomClient";
import type { ChatMessage } from "@/types/voip.types";
import type { RoomInfo } from "@/hooks/realtime/useRoomManager";
import config from "@/config/config";
import useMicrophone from "./useMicrophone";
import usePeerConnection from "./usePeerConnection";
import useRoomSession from "./useRoomSession";
import useScreenshare from "./useScreenshare";
import usePeerVolumes from "./usePeerVolumes";
import useRemoteAudio from "./useRemoteAudio";

const PEER_CONFIG = {
  host: config.PEER_HOST,
  secure: config.PEER_SECURE === "true",
  port: parseInt(config.PEER_PORT, 10),
  path: config.PEER_PATH,
};

const useVoIP = () => {
  const { user, signedIn, turnCredentials } = useAuth();
  const { socket, signalClient, roomClient, isConnected, assignedPeerId } = useConnection();
  const username = user?.username ?? null;

  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [roomList, setRoomList] = useState<RoomInfo[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");

  const mic = useMicrophone();
  const volumes = usePeerVolumes();

  const peerConn = usePeerConnection({
    stream: mic.stream,
    peerId: assignedPeerId ?? "",
    peerConfig: PEER_CONFIG,
  });

  const screenshare = useScreenshare({
    socket,
    currentRoomId,
    peerHost: PEER_CONFIG.host,
    peerPort: PEER_CONFIG.port,
    peerPath: PEER_CONFIG.path,
    peerSecure: PEER_CONFIG.secure,
    onAudioPeerDismissed: volumes.muteVolume,
    onAudioPeerRestored: volumes.restoreVolume,
  });

  const roomSession = useRoomSession({
    socket,
    roomId: currentRoomId ?? "",
    roomClient,
    callPeer: peerConn.callPeer,
    removeRemoteStream: peerConn.removeRemoteStream,
  });

  useRemoteAudio(peerConn.remoteStreams, volumes.volumes);

  useEffect(() => {
    roomSession.connectedPeers.forEach(({ peerId, alias }) => {
      volumes.loadSavedForPeer(peerId, alias);
    });
  }, [roomSession.connectedPeers]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleRoomList = ({ rooms }: { rooms: RoomInfo[] }) => setRoomList(rooms);

    const handleRoomClosed = () => {
      screenshare.clearRoomState();
      peerConn.closeAll();
      mic.release();
      setCurrentRoomId(null);
    };

    const handleRateLimit = ({ action, retryAfter }: { action: string; retryAfter: number }) => {
      console.warn("Rate limited:", action, "retry after:", retryAfter);
    };

    const handleJoinError = ({ message: msg }: { message: string }) => {
      console.error("Join room error:", msg);
    };

    socket.on("room-list", handleRoomList);
    socket.on("room-closed", handleRoomClosed);
    socket.on("rate-limit-exceeded", handleRateLimit);
    socket.on("join-error", handleJoinError);

    return () => {
      socket.off("room-list", handleRoomList);
      socket.off("room-closed", handleRoomClosed);
      socket.off("rate-limit-exceeded", handleRateLimit);
      socket.off("join-error", handleJoinError);
    };
  }, [socket, isConnected]);

  useEffect(() => {
    if (!roomClient) return;
    roomClient.onRoomMessageDecrypted = (msg: DecryptedRoomMessage) => {
      setChatMessages(prev => [
        ...prev,
        {
          sender: msg.senderUserId,
          message: msg.message,
          alias: msg.senderAlias,
          timestamp: msg.timestamp,
        },
      ]);
    };
  }, [roomClient]);

  const joinRoom = useCallback(async (roomId: string): Promise<void> => {
    if (!socket || !isConnected || !turnCredentials) return;

    const micOk = await mic.acquire();
    if (!micOk) return;

    const peerReady = await peerConn.waitForOpen();
    if (!peerReady) return;

    screenshare.clearRoomState();
    peerConn.closeAll();
    socket.emit("join-room", { roomId, alias: username, userId: user?.sub });
    setCurrentRoomId(roomId);
  }, [socket, isConnected, turnCredentials, mic.acquire, peerConn.waitForOpen, peerConn.closeAll, screenshare.clearRoomState, username]);

  const leaveRoom = useCallback((): void => {
    if (socket && currentRoomId) {
      socket.emit("leave-room", { roomId: currentRoomId });
    }
    roomClient?.leaveRoom();
    screenshare.clearRoomState();
    peerConn.closeAll();
    mic.release();
    setCurrentRoomId(null);
  }, [socket, currentRoomId, roomClient, screenshare.clearRoomState, peerConn.closeAll, mic.release]);

  const sendMessage = useCallback(async (): Promise<void> => {
    if (!roomClient || !roomClient.isRoomReady() || !message.trim()) return;
    try {
      await roomClient.sendMessage(message);
      setChatMessages(prev => [
        ...prev,
        { sender: "me", message, alias: username ?? "Me" },
      ]);
      setMessage("");
    } catch {
      console.error("Failed to send encrypted message");
    }
  }, [roomClient, message, username]);

  return {
    myPeerId: assignedPeerId ?? "",
    remoteStreams: peerConn.remoteStreams,
    connectedPeers: roomSession.connectedPeers,
    isEncryptionReady: roomSession.isEncryptionReady,
    muted: mic.isMuted,
    toggleMute: mic.toggleMute,
    isVoiceActive: mic.isReady,
    peerVolumes: volumes.volumes,
    setPeerVolume: volumes.setVolume,
    saveVolumeForAlias: volumes.saveForAlias,
    isSharing: screenshare.isSharing,
    localScreenStream: screenshare.localScreenStream,
    remoteScreenStreams: screenshare.remoteScreenStreams,
    startScreenShare: screenshare.startScreenShare,
    stopScreenShare: screenshare.stopScreenShare,
    dismissScreenShare: screenshare.dismissScreenShare,
    dismissedPeerIds: screenshare.dismissedPeerIds,
    restoreScreenShare: screenshare.restoreScreenShare,
    roomList,
    currentRoomId,
    joinRoom,
    leaveRoom,
    chatMessages,
    message,
    setMessage,
    sendMessage,
    isConnected,
    isAuthenticated: signedIn,
    socket,
    signalClient,
    user,
    turnCredentials,
  };
};

export default useVoIP;