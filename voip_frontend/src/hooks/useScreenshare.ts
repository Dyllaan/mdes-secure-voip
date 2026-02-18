import { useState, useRef, useCallback, useEffect } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import type { Socket } from "socket.io-client";

export interface RemoteScreenStream {
    peerId: string;
    alias: string;
    stream: MediaStream;
}

interface UseScreenShareOptions {
    socket: Socket | null;
    currentRoomId: string | null;
    roomPeerIds: string[];
    peerHost: string;
    peerPort: number;
    peerPath: string;
    peerSecure: boolean;
}

const useScreenshare = ({
    socket,
    currentRoomId,
    roomPeerIds,
    peerHost,
    peerPort,
    peerPath,
    peerSecure,
}: UseScreenShareOptions) => {
    const [isSharing,           setIsSharing]           = useState(false);
    const [localScreenStream,   setLocalScreenStream]   = useState<MediaStream | null>(null);
    const [remoteScreenStreams, setRemoteScreenStreams] = useState<RemoteScreenStream[]>([]);

    const screenPeerRef     = useRef<Peer | null>(null);
    const screenPeerIdRef   = useRef<string | null>(null);
    const screenCallsRef    = useRef<Map<string, MediaConnection>>(new Map());
    const localStreamRef    = useRef<MediaStream | null>(null);
    const currentRoomIdRef  = useRef<string | null>(currentRoomId);

    // Track audio peerId -> screen peerId for room-scoping incoming calls
    const allowedScreenPeerIds = useRef<Set<string>>(new Set());
    // audio peerId -> screen peerId mapping for cleanup
    const peerScreenPeerIds    = useRef<Map<string, string>>(new Map());
    // screen peerId -> alias for labelling
    const pendingAliasRef      = useRef<Map<string, string>>(new Map());

    useEffect(() => { currentRoomIdRef.current = currentRoomId; }, [currentRoomId]);

    // Clear room-scoped state when leaving a room
    useEffect(() => {
        if (!currentRoomId) {
            allowedScreenPeerIds.current.clear();
            peerScreenPeerIds.current.clear();
            pendingAliasRef.current.clear();
            setRemoteScreenStreams([]);
        }
    }, [currentRoomId]);

    const removeRemoteScreenStream = useCallback((screenPeerId: string) => {
        setRemoteScreenStreams(prev => prev.filter(rs => rs.peerId !== screenPeerId));
        pendingAliasRef.current.delete(screenPeerId);
        allowedScreenPeerIds.current.delete(screenPeerId);
    }, []);

    // Create the dedicated screen Peer instance once socket is ready
    useEffect(() => {
        if (!socket) return;

        socket.emit("request-screen-peer-id");

        const handleScreenPeerAssigned = ({ peerId }: { peerId: string }) => {
            console.log("Screen share peer ID assigned:", peerId);

            const screenPeer = new Peer(peerId, {
                host:   peerHost,
                secure: peerSecure,
                port:   peerPort,
                path:   peerPath,
                debug:  1,
            });

            screenPeer.on("open", (id) => {
                console.log("Screen share PeerJS ready:", id);
                screenPeerIdRef.current = id;
            });

            screenPeer.on("call", (incomingCall: MediaConnection) => {
                // ── Room gate for screen calls ──────────────────────────────
                if (!allowedScreenPeerIds.current.has(incomingCall.peer)) {
                    console.warn("Rejecting screen call from unknown peer:", incomingCall.peer);
                    incomingCall.close();
                    return;
                }

                console.log("Incoming screenshare call from:", incomingCall.peer);
                incomingCall.answer();

                incomingCall.on("stream", (remoteStream: MediaStream) => {
                    const alias = pendingAliasRef.current.get(incomingCall.peer) ?? incomingCall.peer;
                    console.log("Received screenshare stream from:", alias);
                    setRemoteScreenStreams(prev =>
                        prev.some(rs => rs.peerId === incomingCall.peer)
                            ? prev.map(rs => rs.peerId === incomingCall.peer ? { ...rs, stream: remoteStream } : rs)
                            : [...prev, { peerId: incomingCall.peer, alias, stream: remoteStream }]
                    );
                });

                incomingCall.on("close", () => removeRemoteScreenStream(incomingCall.peer));
                incomingCall.on("error", () => removeRemoteScreenStream(incomingCall.peer));
            });

            screenPeer.on("error", (err) => console.error("Screen share peer error:", err));

            screenPeerRef.current = screenPeer;
        };

        socket.on("screen-peer-assigned", handleScreenPeerAssigned);

        return () => {
            socket.off("screen-peer-assigned", handleScreenPeerAssigned);
            screenPeerRef.current?.destroy();
            screenPeerRef.current = null;
            screenPeerIdRef.current = null;
        };
    }, [socket, peerHost, peerPort, peerPath, peerSecure, removeRemoteScreenStream]);

    const callPeerWithScreen = useCallback((screenPeerIdOfTarget: string, stream: MediaStream) => {
        const screenPeer = screenPeerRef.current;
        if (!screenPeer) return;

        console.log("Calling screen peer:", screenPeerIdOfTarget);
        const call = screenPeer.call(screenPeerIdOfTarget, stream);
        screenCallsRef.current.set(screenPeerIdOfTarget, call);

        call.on("error", (err) => console.error("Screenshare call error to", screenPeerIdOfTarget, err));
    }, []);

    const stopScreenShare = useCallback(() => {
        if (!socket || !currentRoomIdRef.current) return;

        localStreamRef.current?.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;

        screenCallsRef.current.forEach(call => { try { call.close(); } catch {} });
        screenCallsRef.current.clear();

        setLocalScreenStream(null);
        setIsSharing(false);

        socket.emit("screenshare-stopped", { roomId: currentRoomIdRef.current });
        console.log("Screen share stopped");
    }, [socket]);

    const startScreenShare = useCallback(async () => {
        if (!socket || !currentRoomIdRef.current || !screenPeerRef.current) {
            console.error("Cannot start screenshare - not ready");
            return;
        }

        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 30 },
                audio: false,
            });

            localStreamRef.current = screenStream;
            setLocalScreenStream(screenStream);
            setIsSharing(true);

            socket.emit("screenshare-started", {
                roomId: currentRoomIdRef.current,
                screenPeerId: screenPeerIdRef.current,
            });

            screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
            console.log("Screen share started");
        } catch (err: any) {
            if (err.name !== "NotAllowedError") {
                console.error("Failed to start screen share:", err);
            }
        }
    }, [socket, stopScreenShare]);

    // Server sends us the screen peer IDs of everyone in the room after we start sharing
    const handleRoomScreenPeerIds = useCallback((
        peers: Array<{ screenPeerId: string; alias: string }>
    ) => {
        const stream = localStreamRef.current;
        if (!stream) return;
        peers.forEach(({ screenPeerId, alias }) => {
            console.log("Calling room member with screenshare:", alias);
            callPeerWithScreen(screenPeerId, stream);
        });
    }, [callPeerWithScreen]);

    // Server tells us a peer started sharing — register their screen peer ID
    // so our screen Peer allows their incoming call
    const handlePeerScreenshareStarted = useCallback((
        audioPeerId: string,
        alias: string,
        screenPeerId: string,
    ) => {
        console.log(`Peer ${alias} started screenshare with screen peer: ${screenPeerId}`);
        pendingAliasRef.current.set(screenPeerId, alias);
        peerScreenPeerIds.current.set(audioPeerId, screenPeerId);
        allowedScreenPeerIds.current.add(screenPeerId);
    }, []);

    // Server tells sharer that a new user joined — call them with the screen stream
    const handleNewScreenPeer = useCallback(({
        screenPeerId,
        alias,
    }: { screenPeerId: string; alias: string }) => {
        const stream = localStreamRef.current;
        if (!stream || !isSharing) return;
        console.log("New joiner detected, calling with screenshare:", alias);
        callPeerWithScreen(screenPeerId, stream);
    }, [isSharing, callPeerWithScreen]);

    const handleRemoteScreenShareStopped = useCallback((audioPeerId: string) => {
        const screenPeerId = peerScreenPeerIds.current.get(audioPeerId);
        if (screenPeerId) {
            removeRemoteScreenStream(screenPeerId);
            peerScreenPeerIds.current.delete(audioPeerId);
        }
    }, [removeRemoteScreenStream]);

    const dismissScreenShare = useCallback((screenPeerId: string) => {
        removeRemoteScreenStream(screenPeerId);
        // Close the incoming call so the stream stops
        const call = screenCallsRef.current.get(screenPeerId);
        if (call) {
            try { call.close(); } catch {}
            screenCallsRef.current.delete(screenPeerId);
        }
    }, [removeRemoteScreenStream]);

    return {
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
        screenPeerIdRef,
    };
};

export default useScreenshare;