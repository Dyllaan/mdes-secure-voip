import { useEffect, useRef, useState, useCallback } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import config from "@/config/config";
import { SimpleNoiseGate } from "@/utils/SimpleNoiseGate";
import { useAuth } from "@/hooks/useAuth";
import { useConnection } from "@/components/providers/ConnectionProvider";
import type { DecryptedRoomMessage } from "@/utils/RoomClient";
import useRoom from "./useRoom";
import useScreenShare from "./useScreenshare";
import { optimiseBitrate } from '@/utils/OptimiseBitrate';
import type { RoomInfo } from "./useRoomManager";

export interface ChatMessage {
  sender: string;
  message: string;
  alias: string;
  timestamp?: string;
}

export interface RemoteStream {
  peerId: string;
  stream: MediaStream;
}

const PEER_HOST = config.PEER_HOST;
const PEER_SECURE = config.PEER_SECURE === "true";
const PEER_PORT = parseInt(config.PEER_PORT, 10);
const PEER_PATH = config.PEER_PATH;

const useVoIP = () => {
  const { user, signedIn } = useAuth();
  const { socket, signalClient, roomClient, isConnected, assignedPeerId } = useConnection();
  const username = user?.username ?? null;

  const [roomList, setRoomList] = useState<RoomInfo[]>([]);
  const [myPeerId, setMyPeerId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  const [mutedPeerIds, _] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);

  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const noiseGateRef = useRef<SimpleNoiseGate | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const roomPeerIdsRef = useRef<Set<string>>(new Set());
  const voiceInitializedRef = useRef(false);

  const [peer, setPeer] = useState<Peer | null>(null);
  const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);

  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});

  const addRoomPeer = useCallback((peerId: string) => { roomPeerIdsRef.current.add(peerId); }, []);
  const removeRoomPeer = useCallback((peerId: string) => { roomPeerIdsRef.current.delete(peerId); }, []);
  const clearRoomPeers = useCallback(() => { roomPeerIdsRef.current.clear(); }, []);

  const {
    remoteStreams,
    isEncryptionReady,
    connectedPeers,
    addRemoteStream,
    removeStream,
    registerIncomingConnection,
    closeAllConnections,
  } = useRoom({
    socket,
    peer,
    roomClient,
    processedStream,
    roomId: currentRoomId ?? "",
    onPeerJoined: addRoomPeer,
    onPeerLeft: removeRoomPeer,
    onRoomCleared: clearRoomPeers,
  });

  const {
    isSharing,
    localScreenStream,
    remoteScreenStreams,
    startScreenShare,
    stopScreenShare,
    dismissScreenShare,
    handleRoomScreenPeerIds,
    handlePeerScreenshareStarted,
    handleRemoteScreenShareStopped,
    handleNewScreenPeer,
    dismissedPeerIds,
    restoreScreenShare,
  } = useScreenShare({
    socket,
    currentRoomId,
    peerHost: PEER_HOST,
    peerPort: PEER_PORT,
    peerPath: PEER_PATH,
    peerSecure: PEER_SECURE,
  });

  const peerVolumeRef = useRef<Record<string, number>>({});

  const setPeerVolume = useCallback((peerId: string, volume: number) => {
    setPeerVolumes(prev => ({ ...prev, [peerId]: volume }));
    peerVolumeRef.current[peerId] = volume;
  }, []);

  // ── Screenshare signalling ──────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleRoomScreenPeers = ({ peers }: { peers: Array<{ screenPeerId: string; alias: string }> }) => {
      handleRoomScreenPeerIds(peers);
    };
    const handlePeerStarted = ({ peerId, alias, screenPeerId }: { peerId: string; alias: string; screenPeerId: string }) => {
      handlePeerScreenshareStarted(peerId, alias, screenPeerId);
    };
    const handlePeerStopped = ({ peerId }: { peerId: string }) => {
      handleRemoteScreenShareStopped(peerId);
    };
    const handleNewPeer = (data: { screenPeerId: string; alias: string }) => {
      handleNewScreenPeer(data);
    };

    socket.on("room-screen-peers", handleRoomScreenPeers);
    socket.on("peer-screenshare-started", handlePeerStarted);
    socket.on("peer-screenshare-stopped", handlePeerStopped);
    socket.on("new-screen-peer", handleNewPeer);

    return () => {
      socket.off("room-screen-peers", handleRoomScreenPeers);
      socket.off("peer-screenshare-started", handlePeerStarted);
      socket.off("peer-screenshare-stopped", handlePeerStopped);
      socket.off("new-screen-peer", handleNewPeer);
    };
  }, [socket, handleRoomScreenPeerIds, handlePeerScreenshareStarted, handleRemoteScreenShareStopped, handleNewScreenPeer]);

  // ── Room client message callback ────────────────────────────────────────
  useEffect(() => {
    if (!roomClient) return;

    roomClient.onRoomMessageDecrypted = (decryptedMsg: DecryptedRoomMessage) => {
      setChatMessages(prev => [...prev, {
        sender: decryptedMsg.senderUserId,
        message: decryptedMsg.message,
        alias: decryptedMsg.senderAlias,
        timestamp: decryptedMsg.timestamp,
      }]);
    };
  }, [roomClient]);

  // ── Lightweight socket listeners ────────────────────────────────────────
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleJoinError = ({ message: errMsg }: { message: string }) =>
      console.error("Join room error:", errMsg);

    const handleRoomClosed = () => {
      setCurrentRoomId(null);
      roomPeerIdsRef.current.clear();
      cleanupVoice();
    };

    const handleRoomList = ({ rooms }: { rooms: RoomInfo[] }) => {
      setRoomList(rooms);
    };

    const handleRateLimit = ({ action, retryAfter }: { action: string; retryAfter: number }) => {
      console.warn("Rate limit exceeded:", action, "retry after:", retryAfter);
    };

    socket.on("join-error", handleJoinError);
    socket.on("room-closed", handleRoomClosed);
    socket.on("room-list", handleRoomList);
    socket.on("rate-limit-exceeded", handleRateLimit);

    return () => {
      socket.off("join-error", handleJoinError);
      socket.off("room-closed", handleRoomClosed);
      socket.off("room-list", handleRoomList);
      socket.off("rate-limit-exceeded", handleRateLimit);
    };
  }, [socket, isConnected]);

  const createPeerInstance = useCallback((peerId: string) => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    const newPeer = new Peer(peerId, {
      host:   PEER_HOST,
      secure: PEER_SECURE,
      port:   PEER_PORT,
      path:   PEER_PATH,
      debug:  3,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'turn:192.168.1.245:3478?transport=udp', username: 'talk', credential: 'talkpass' },
        ],
      },
    });

    peerRef.current = newPeer;
    setPeer(newPeer);

    newPeer.on("open", (id: string) => {
      setMyPeerId(id);
      console.log("PeerJS connected with ID:", id);
    });

    newPeer.on("call", (incomingCall: MediaConnection) => {
      // Accept optimistically — the PeerJS server only routes messages between
      // authenticated sockets so any caller is already room-validated server-side.
      // The strict Set check caused a race condition: the bot's PeerJS OFFER
      // arrived before the 'user-connected' socket event fired and added the
      // bot's peerId to roomPeerIdsRef, so the call was being silently rejected.
      if (!roomPeerIdsRef.current.has(incomingCall.peer)) {
        console.log(`[peer.on(call)] ${incomingCall.peer} not yet in roomPeerIds — adding and accepting`);
        roomPeerIdsRef.current.add(incomingCall.peer);
      }

      console.log("Incoming audio call from:", incomingCall.peer);
      registerIncomingConnection(incomingCall.peer, incomingCall);

      const waitForStream = (): void => {
        if (processedStreamRef.current) {
          incomingCall.answer(processedStreamRef.current, { sdpTransform: optimiseBitrate });
        } else {
          setTimeout(waitForStream, 100);
        }
      };
      waitForStream();

      incomingCall.on("stream", (remoteStream: MediaStream) => {
        console.log(`[peer.on(call)] stream from ${incomingCall.peer} — audio: ${remoteStream.getAudioTracks().length}`);
        addRemoteStream(incomingCall.peer, remoteStream);
      });
      incomingCall.on("close", () => removeStream(incomingCall.peer));
      incomingCall.on("error", () => removeStream(incomingCall.peer));
    });

    newPeer.on("error", (error) => console.error("PeerJS error:", error));

    return newPeer;
  }, [addRemoteStream, removeStream, registerIncomingConnection]);

  // ── Lazy voice initialization ───────────────────────────────────────────
  const initializeVoice = useCallback(async (): Promise<boolean> => {
    if (voiceInitializedRef.current) return true;

    if (!assignedPeerId) {
      console.error("No peer ID assigned by server yet");
      return false;
    }

    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
        },
      });

      localStreamRef.current = rawStream;
      if (localAudioRef.current) localAudioRef.current.srcObject = rawStream;

      processedStreamRef.current = rawStream;
      setProcessedStream(rawStream);

      createPeerInstance(assignedPeerId);

      voiceInitializedRef.current = true;
      setIsVoiceActive(true);
      return true;
    } catch (err) {
      console.error("Failed to get local stream:", err);
      return false;
    }
  }, [createPeerInstance, assignedPeerId]);

  // ── Voice cleanup ───────────────────────────────────────────────────────
  const cleanupVoice = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    processedStreamRef.current?.getTracks().forEach(t => t.stop());
    noiseGateRef.current?.cleanup();
    peerRef.current?.destroy();

    localStreamRef.current = null;
    processedStreamRef.current = null;
    noiseGateRef.current = null;
    peerRef.current = null;
    roomPeerIdsRef.current.clear();

    setPeer(null);
    setProcessedStream(null);
    setMyPeerId("");

    voiceInitializedRef.current = false;
    setIsVoiceActive(false);
  }, []);

  useEffect(() => {
    return () => { cleanupVoice(); };
  }, [cleanupVoice]);

  // ── Join room ───────────────────────────────────────────────────────────
  const joinRoom = useCallback(async (roomId: string): Promise<void> => {
    if (!socket || !isConnected) {
      console.error("Not connected");
      return;
    }

    const success = await initializeVoice();
    if (!success) {
      console.error("Failed to initialize voice - mic access denied?");
      return;
    }

    if (!peerRef.current?.open) {
      let attempts = 0;
      while (!peerRef.current?.open && attempts < 40) {
        await new Promise(resolve => setTimeout(resolve, 250));
        attempts++;
      }
      if (!peerRef.current?.open) {
        console.error("PeerJS failed to connect");
        return;
      }
    }

    if (signalClient && !signalClient.isReady()) {
      let attempts = 0;
      while (!signalClient.isReady() && attempts < 40) {
        await new Promise(resolve => setTimeout(resolve, 250));
        attempts++;
      }
    }

    closeAllConnections();
    roomPeerIdsRef.current.clear();
    socket.emit("join-room", { roomId, alias: username, userId: username });
    setCurrentRoomId(roomId);
  }, [socket, signalClient, isConnected, username, closeAllConnections, initializeVoice]);

  // ── Leave room ──────────────────────────────────────────────────────────
  const leaveRoom = useCallback((): void => {
    if (socket && currentRoomId) {
      socket.emit("leave-room", { roomId: currentRoomId });
    }
    roomClient?.leaveRoom();
    closeAllConnections();
    setCurrentRoomId(null);
    cleanupVoice();
  }, [socket, currentRoomId, roomClient, closeAllConnections, cleanupVoice]);

  // ── Send room message ───────────────────────────────────────────────────
  const sendMessage = useCallback(async (): Promise<void> => {
    if (!roomClient) { console.error("Room client not ready"); return; }
    if (!roomClient.isRoomReady()) { console.error("Room encryption not ready"); return; }
    if (!message.trim()) return;

    try {
      await roomClient.sendMessage(message);
      setChatMessages(prev => [...prev, { sender: "me", message, alias: username ?? "Me" }]);
      setMessage("");
    } catch (error) {
      console.error("Failed to send encrypted message:", error);
    }
  }, [roomClient, message, username]);

  const toggleMute = useCallback(() => {
    if (processedStreamRef.current) {
      processedStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = muted;
      });
    }
    setMuted(prev => !prev);
  }, [muted]);

  return {
    myPeerId,
    chatMessages,
    message,
    setMessage,
    sendMessage,
    remoteStreams,
    localAudioRef,
    socket,
    noiseGate: noiseGateRef.current,
    isConnected,
    isAuthenticated: signedIn,
    isEncryptionReady,
    currentRoomId,
    joinRoom,
    leaveRoom,
    user,
    signalClient,
    isSharing,
    localScreenStream,
    remoteScreenStreams,
    startScreenShare,
    stopScreenShare,
    dismissScreenShare,
    roomList,
    connectedPeers,
    isVoiceActive,
    initializeVoice,
    cleanupVoice,
    handleRoomScreenPeerIds,
    dismissedPeerIds,
    restoreScreenShare,
    mutedPeerIds,
    muted,
    toggleMute,
    peerVolumes,
    setPeerVolume,
    peerVolumeRef,
  };
};

export default useVoIP;