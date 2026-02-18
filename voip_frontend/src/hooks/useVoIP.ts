import { useEffect, useRef, useState, useCallback } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import config from "../config/config";
import { SimpleNoiseGate } from "../utils/SimpleNoiseGate";
import { useAuth } from "./useAuth";
import { SignalProtocolClient } from "../utils/SignalProtocolClient";
import type { DecryptedMessage } from "../utils/SignalProtocolClient";
import useRoom from "./useRoom";
import useScreenShare from "./useScreenshare";

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

const PEER_HOST   = config.PEER_HOST;
const PEER_SECURE = config.PEER_SECURE === "true";
const PEER_PORT   = parseInt(config.PEER_PORT, 10);
const PEER_PATH   = config.PEER_PATH;

const useVoIP = () => {
    const { accessToken, user, isAuthenticated } = useAuth();

    const userId   = user?.id?.toString() ?? null;
    const username = user?.username       ?? null;

    const [myPeerId,      setMyPeerId]      = useState<string>("");
    const [chatMessages,  setChatMessages]  = useState<ChatMessage[]>([]);
    const [message,       setMessage]       = useState<string>("");
    const [isConnected,   setIsConnected]   = useState<boolean>(false);
    const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);

    const localAudioRef      = useRef<HTMLAudioElement | null>(null);
    const localStreamRef     = useRef<MediaStream | null>(null);
    const processedStreamRef = useRef<MediaStream | null>(null);
    const noiseGateRef       = useRef<SimpleNoiseGate | null>(null);
    const peerRef            = useRef<Peer | null>(null);
    const socketRef          = useRef<Socket | null>(null);
    const signalClientRef    = useRef<SignalProtocolClient | null>(null);
    const accessTokenRef     = useRef<string | null>(accessToken);

    const roomPeerIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);

    const [socket,          setSocket]          = useState<Socket | null>(null);
    const [peer,            setPeer]            = useState<Peer | null>(null);
    const [signalClient,    setSignalClient]    = useState<SignalProtocolClient | null>(null);
    const [processedStream, setProcessedStream] = useState<MediaStream | null>(null);

    const addRoomPeer = useCallback((peerId: string) => {
        roomPeerIdsRef.current.add(peerId);
    }, []);

    const removeRoomPeer = useCallback((peerId: string) => {
        roomPeerIdsRef.current.delete(peerId);
    }, []);

    const clearRoomPeers = useCallback(() => {
        roomPeerIdsRef.current.clear();
    }, []);

    const {
        remoteStreams,
        isEncryptionReady,
        roomPeerIds,
        addRemoteStream,
        removeStream,
        registerIncomingConnection,
        closeAllConnections,
    } = useRoom({
        socket,
        peer,
        signalClient,
        processedStream,
        username,
        roomId: currentRoomId ?? "",
        onPeerJoined:  addRoomPeer,
        onPeerLeft:    removeRoomPeer,
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
    } = useScreenShare({
        socket,
        currentRoomId,
        roomPeerIds,
        peerHost:   PEER_HOST,
        peerPort:   PEER_PORT,
        peerPath:   PEER_PATH,
        peerSecure: PEER_SECURE,
    });

    // ── Screenshare signalling ────────────────────────────────────────────────
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

        socket.on("room-screen-peers",        handleRoomScreenPeers);
        socket.on("peer-screenshare-started", handlePeerStarted);
        socket.on("peer-screenshare-stopped", handlePeerStopped);
        socket.on("new-screen-peer",          handleNewPeer);

        return () => {
            socket.off("room-screen-peers",        handleRoomScreenPeers);
            socket.off("peer-screenshare-started", handlePeerStarted);
            socket.off("peer-screenshare-stopped", handlePeerStopped);
            socket.off("new-screen-peer",          handleNewPeer);
        };
    }, [socket, handleRoomScreenPeerIds, handlePeerScreenshareStarted, handleRemoteScreenShareStopped, handleNewScreenPeer]);

    useEffect(() => {
        if (!isAuthenticated || !accessToken || !userId || !username) return;

        let cancelled = false;

        const initializeAudio = async (): Promise<void> => {
            try {
                const rawStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl:  true,
                        sampleRate:       48000,
                    },
                });

                if (cancelled) { rawStream.getTracks().forEach(t => t.stop()); return; }

                localStreamRef.current = rawStream;
                if (localAudioRef.current) localAudioRef.current.srcObject = rawStream;

                const noiseGate = new SimpleNoiseGate();
                noiseGateRef.current = noiseGate;

                const processed = await noiseGate.processStream(rawStream);
                if (cancelled) {
                    rawStream.getTracks().forEach(t => t.stop());
                    processed.getTracks().forEach(t => t.stop());
                    noiseGate.cleanup();
                    return;
                }

                processedStreamRef.current = processed;
                setProcessedStream(processed);
            } catch (err) {
                console.error("Failed to get local stream", err);
            }
        };

        initializeAudio();

        const voipSocket = io(config.SIGNALING_SERVER, {
            path:                 "/socket.io/",
            auth:                 (cb) => cb({ token: accessTokenRef.current }),
            transports:           ["websocket", "polling"],
            withCredentials:      true,
            reconnection:         true,
            reconnectionDelay:    1000,
            reconnectionAttempts: 5,
        });

        socketRef.current = voipSocket;
        setSocket(voipSocket);

        voipSocket.on("connect", async () => {
            if (cancelled) return;
            console.log("Socket.IO connected:", voipSocket.id);
            setIsConnected(true);

            if (!userId) return;

            try {
                const client = new SignalProtocolClient(userId, voipSocket);
                signalClientRef.current = client;

                client.onRoomMessageDecrypted = (decryptedMsg: DecryptedMessage) => {
                    if (cancelled) return;
                    setChatMessages(prev => [...prev, {
                        sender:    decryptedMsg.senderUserId,
                        message:   decryptedMsg.message,
                        alias:     decryptedMsg.senderAlias,
                        timestamp: decryptedMsg.timestamp,
                    }]);
                };

                await client.initialize();
                if (!cancelled) setSignalClient(client);
            } catch (error) {
                console.error("Failed to initialize encryption:", error);
            }
        });

        voipSocket.on("connect_error", (error) => {
            console.error("Socket.IO connection error:", error.message);
            if (!cancelled) setIsConnected(false);
        });

        voipSocket.on("disconnect", (reason) => {
            console.log("Socket.IO disconnected:", reason);
            if (!cancelled) {
                setIsConnected(false);
                setCurrentRoomId(null);
                roomPeerIdsRef.current.clear();
            }
        });

        voipSocket.on("join-error",  ({ message: errMsg }: { message: string }) => console.error("Join room error:", errMsg));
        voipSocket.on("room-closed", () => { if (!cancelled) { setCurrentRoomId(null); roomPeerIdsRef.current.clear(); } });
        voipSocket.on("rate-limit-exceeded", ({ action, retryAfter }: { action: string; retryAfter: number }) => {
            console.warn("Rate limit exceeded:", action, "retry after:", retryAfter);
        });

        voipSocket.on("peer-assigned", ({ peerId }: { peerId: string }) => {
            if (cancelled) return;

            const newPeer = new Peer(peerId, {
                host:   PEER_HOST,
                secure: PEER_SECURE,
                port:   PEER_PORT,
                path:   PEER_PATH,
                debug:  3,
            });

            peerRef.current = newPeer;
            setPeer(newPeer);

            newPeer.on("open", (id: string) => {
                if (cancelled) return;
                setMyPeerId(id);
            });

            // Audio-only call handler — screenshare calls go to the dedicated screen Peer
            newPeer.on("call", (incomingCall: MediaConnection) => {
                if (cancelled) return;

                if (!roomPeerIdsRef.current.has(incomingCall.peer)) {
                    console.warn(`Rejecting call from peer not in room: ${incomingCall.peer}`);
                    incomingCall.close();
                    return;
                }

                console.log("Incoming audio call from:", incomingCall.peer);
                registerIncomingConnection(incomingCall.peer, incomingCall);

                const waitForStream = (): void => {
                    if (cancelled) return;
                    if (processedStreamRef.current) {
                        incomingCall.answer(processedStreamRef.current);
                    } else {
                        setTimeout(waitForStream, 100);
                    }
                };
                waitForStream();

                incomingCall.on("stream", (remoteStream: MediaStream) => {
                    if (cancelled) return;
                    addRemoteStream(incomingCall.peer, remoteStream);
                });

                incomingCall.on("close",  () => removeStream(incomingCall.peer));
                incomingCall.on("error",  () => removeStream(incomingCall.peer));
            });

            newPeer.on("error", (error) => console.error("PeerJS error:", error));
        });

        return () => {
            cancelled = true;
            localStreamRef.current?.getTracks().forEach(t => t.stop());
            processedStreamRef.current?.getTracks().forEach(t => t.stop());
            noiseGateRef.current?.cleanup();
            signalClientRef.current?.cleanup();
            peerRef.current?.destroy();
            voipSocket.disconnect();

            localStreamRef.current     = null;
            processedStreamRef.current = null;
            noiseGateRef.current       = null;
            signalClientRef.current    = null;
            peerRef.current            = null;
            socketRef.current          = null;

            roomPeerIdsRef.current.clear();

            setSocket(null);
            setPeer(null);
            setSignalClient(null);
            setProcessedStream(null);
            setIsConnected(false);
            setCurrentRoomId(null);
        };

    }, [isAuthenticated, accessToken, userId, username, addRemoteStream, removeStream, registerIncomingConnection]);

    const joinRoom = useCallback(async (roomId: string): Promise<void> => {
        const voipSocket = socketRef.current;
        const client     = signalClientRef.current;

        if (!voipSocket || !myPeerId) { console.error("Not connected"); return; }

        if (client && !client.isReady()) {
            let attempts = 0;
            while (!client.isReady() && attempts < 40) {
                await new Promise(resolve => setTimeout(resolve, 250));
                attempts++;
            }
        }

        closeAllConnections();
        roomPeerIdsRef.current.clear();

        voipSocket.emit("join-room", { roomId, alias: username });
        setCurrentRoomId(roomId);
    }, [myPeerId, username, closeAllConnections]);

    const leaveRoom = useCallback((): void => {
        const voipSocket = socketRef.current;
        if (voipSocket && currentRoomId) {
            voipSocket.emit("leave-room", { roomId: currentRoomId });
        }
        closeAllConnections();
        roomPeerIdsRef.current.clear();
        setCurrentRoomId(null);
    }, [currentRoomId, closeAllConnections]);

    const sendMessage = useCallback(async (): Promise<void> => {
        const client = signalClientRef.current;
        if (!client)               { console.error("Signal client not ready"); return; }
        if (!client.isRoomReady()) { console.error("Room encryption not ready"); return; }
        if (!message.trim())       return;

        try {
            await client.sendRoomMessage(message);
            setChatMessages(prev => [...prev, { sender: "me", message, alias: username ?? "Me" }]);
            setMessage("");
        } catch (error) {
            console.error("Failed to send encrypted message:", error);
        }
    }, [message, username]);

    return {
        myPeerId,
        chatMessages,
        message,
        setMessage,
        sendMessage,
        remoteStreams,
        localAudioRef,
        socket:           socketRef.current,
        noiseGate:        noiseGateRef.current,
        isConnected,
        isAuthenticated,
        isEncryptionReady,
        currentRoomId,
        joinRoom,
        leaveRoom,
        user,
        signalClient:     signalClientRef.current,
        isSharing,
        localScreenStream,
        remoteScreenStreams,
        startScreenShare,
        stopScreenShare,
        dismissScreenShare,
    };
};

export default useVoIP;