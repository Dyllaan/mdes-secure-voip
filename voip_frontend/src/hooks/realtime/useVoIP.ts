import { useEffect, useRef, useState, useCallback } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import config from "@/config/config";
import { SimpleNoiseGate } from "@/utils/SimpleNoiseGate";
import { useAuth } from "@/hooks/useAuth";
import { useConnection } from "@/components/providers/ConnectionProvider";
import type { DecryptedMessage } from "@/utils/SignalProtocolClient";
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
  const { socket, signalClient, isConnected, assignedPeerId } = useConnection();
  const username = user?.username ?? null;

  const [roomList, setRoomList] = useState<RoomInfo[]>([]);
  const [myPeerId, setMyPeerId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  const [mutedPeerIds, setMutedPeerIds] = useState<Set<string>>(new Set());
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
    signalClient,
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
      // Find the audio element for this peer and apply directly
      // VoicePanel's audioElementsRef isn't accessible here, so we use a shared ref
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

  // ── Set up signal client callbacks ──────────────────────────────────────
  useEffect(() => {
    if (!signalClient) return;

    signalClient.onRoomMessageDecrypted = (decryptedMsg: DecryptedMessage) => {
      setChatMessages(prev => [...prev, {
        sender: decryptedMsg.senderUserId,
        message: decryptedMsg.message,
        alias: decryptedMsg.senderAlias,
        timestamp: decryptedMsg.timestamp,
      }]);
    };
  }, [signalClient]);

  // ── Lightweight socket listeners (bound eagerly, no mic needed) ─────────
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
      if (!roomPeerIdsRef.current.has(incomingCall.peer)) {
        console.warn(`Rejecting call from peer not in room: ${incomingCall.peer}`);
        incomingCall.close();
        return;
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
        addRemoteStream(incomingCall.peer, remoteStream);
      });
      incomingCall.on("close", () => removeStream(incomingCall.peer));
      incomingCall.on("error", () => removeStream(incomingCall.peer));
    });

    newPeer.on("error", (error) => console.error("PeerJS error:", error));

    return newPeer;
  }, [addRemoteStream, removeStream, registerIncomingConnection]);

  // ── Lazy voice initialization (mic + noise gate + PeerJS) ───────────────
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

      // const noiseGate = new SimpleNoiseGate();
      // noiseGateRef.current = noiseGate;
      // const processed = await noiseGate.processStream(rawStream);

      // processedStreamRef.current = processed;
      // setProcessedStream(processed);

      processedStreamRef.current = rawStream;
      setProcessedStream(rawStream);

      // Now create the PeerJS instance with the server-assigned ID
      createPeerInstance(assignedPeerId);

      voiceInitializedRef.current = true;
      setIsVoiceActive(true);
      return true;
    } catch (err) {
      console.error("Failed to get local stream:", err);
      return false;
    }
  }, [createPeerInstance, assignedPeerId]);

  // ── Voice cleanup (mic + PeerJS teardown) ───────────────────────────────
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

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cleanupVoice();
    };
  }, [cleanupVoice]);

  // ── Join room (initializes voice lazily, then waits for PeerJS open) ────
  const joinRoom = useCallback(async (roomId: string): Promise<void> => {
    if (!socket || !isConnected) {
      console.error("Not connected");
      return;
    }

    // Initialize voice if not already active
    const success = await initializeVoice();
    if (!success) {
      console.error("Failed to initialize voice - mic access denied?");
      return;
    }

    // Wait for PeerJS to be ready (open event)
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

  // ── Leave room (cleans up voice) ────────────────────────────────────────
  const leaveRoom = useCallback((): void => {
    if (socket && currentRoomId) {
      socket.emit("leave-room", { roomId: currentRoomId });
    }
    closeAllConnections();
    setCurrentRoomId(null);
    cleanupVoice();
  }, [socket, currentRoomId, closeAllConnections, cleanupVoice]);

  const sendMessage = useCallback(async (): Promise<void> => {
    if (!signalClient) { console.error("Signal client not ready"); return; }
    if (!signalClient.isRoomReady()) { console.error("Room encryption not ready"); return; }
    if (!message.trim()) return;

    try {
      await signalClient.sendRoomMessage(message);
      setChatMessages(prev => [...prev, { sender: "me", message, alias: username ?? "Me" }]);
      setMessage("");
    } catch (error) {
      console.error("Failed to send encrypted message:", error);
    }
  }, [signalClient, message, username]);

  const toggleMute = useCallback(() => {
    if (processedStreamRef.current) {
        processedStreamRef.current.getAudioTracks().forEach(track => {
            track.enabled = muted; // flip: if muted, re-enable
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