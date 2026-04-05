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
    peerHost: string;
    peerPort: number;
    peerPath: string;
    peerSecure: boolean;
    onDismiss?: (screenPeerId: string) => void;
    onRestore?: (screenPeerId: string) => void;
}

const useScreenshare = ({
    socket,
    currentRoomId,
    peerHost,
    peerPort,
    peerPath,
    peerSecure,
    onDismiss,
    onRestore,
}: UseScreenShareOptions) => {
    const [isSharing,           setIsSharing]           = useState(false);
    const [localScreenStream,   setLocalScreenStream]   = useState<MediaStream | null>(null);
    const [remoteScreenStreams, setRemoteScreenStreams] = useState<RemoteScreenStream[]>([]);
    const [dismissedPeerIds,   setDismissedPeerIds]    = useState<Set<string>>(new Set());

    const screenPeerRef     = useRef<Peer | null>(null);
    const screenPeerIdRef   = useRef<string | null>(null);
    const screenCallsRef    = useRef<Map<string, MediaConnection>>(new Map());
    const localStreamRef    = useRef<MediaStream | null>(null);
    const currentRoomIdRef  = useRef<string | null>(currentRoomId);

    // Persistent audio elements for streams that carry audio tracks (e.g. bot AV stream).
    // These are managed outside React so they survive screenshare dismiss/restore.
    const screenAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    const allowedScreenPeerIds = useRef<Set<string>>(new Set());
    const peerScreenPeerIds    = useRef<Map<string, string>>(new Map());
    const pendingAliasRef      = useRef<Map<string, string>>(new Map());

    useEffect(() => { currentRoomIdRef.current = currentRoomId; }, [currentRoomId]);

    useEffect(() => {
        if (!currentRoomId) {
            allowedScreenPeerIds.current.clear();
            peerScreenPeerIds.current.clear();
            pendingAliasRef.current.clear();
            setRemoteScreenStreams([]);
            setDismissedPeerIds(new Set());
            // Clean up any persistent audio elements
            screenAudioElsRef.current.forEach(el => { el.srcObject = null; });
            screenAudioElsRef.current.clear();
        }
    }, [currentRoomId]);

    const closeRemoteScreenStream = useCallback((screenPeerId: string) => {
        setRemoteScreenStreams(prev => prev.filter(rs => rs.peerId !== screenPeerId));
        setDismissedPeerIds(prev => { const next = new Set(prev); next.delete(screenPeerId); return next; });
        pendingAliasRef.current.delete(screenPeerId);
        allowedScreenPeerIds.current.delete(screenPeerId);
        const call = screenCallsRef.current.get(screenPeerId);
        if (call) {
            try { call.close(); } catch {}
            screenCallsRef.current.delete(screenPeerId);
        }
        // Clean up persistent audio element if present
        const audioEl = screenAudioElsRef.current.get(screenPeerId);
        if (audioEl) {
            audioEl.srcObject = null;
            screenAudioElsRef.current.delete(screenPeerId);
        }
    }, []);

    const dismissScreenShare = useCallback((screenPeerId: string) => {
        setDismissedPeerIds(prev => new Set([...prev, screenPeerId]));
        // Mute persistent audio (bot streams) when dismissed
        const audioEl = screenAudioElsRef.current.get(screenPeerId);
        if (audioEl) audioEl.muted = true;
        onDismiss?.(screenPeerId);
    }, []);

    const restoreScreenShare = useCallback((screenPeerId: string) => {
        setDismissedPeerIds(prev => { const next = new Set(prev); next.delete(screenPeerId); return next; });
        // Restore persistent audio (bot streams) when restored
        const audioEl = screenAudioElsRef.current.get(screenPeerId);
        if (audioEl) audioEl.muted = false;
        onRestore?.(screenPeerId);
    }, []);

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

                    // If the stream carries audio tracks (in video mode) manage a
                    // persistent audio element so audio survives dismiss/restore.
                    // The ScreenshareVideo video element is muted so audio plays here only.
                    if (remoteStream.getAudioTracks().length > 0) {
                        const existing = screenAudioElsRef.current.get(incomingCall.peer);
                        if (existing) { existing.srcObject = null; }
                        const audioEl = new Audio();
                        audioEl.srcObject = remoteStream;
                        audioEl.autoplay = true;
                        audioEl.play().catch(e => console.warn("Screen audio autoplay blocked:", e));
                        screenAudioElsRef.current.set(incomingCall.peer, audioEl);
                        console.log("Persistent audio element created for screen peer:", incomingCall.peer);
                    }

                    setRemoteScreenStreams(prev =>
                        prev.some(rs => rs.peerId === incomingCall.peer)
                            ? prev.map(rs => rs.peerId === incomingCall.peer ? { ...rs, stream: remoteStream } : rs)
                            : [...prev, { peerId: incomingCall.peer, alias, stream: remoteStream }]
                    );
                    setDismissedPeerIds(prev => { const next = new Set(prev); next.delete(incomingCall.peer); return next; });
                });

                incomingCall.on("close", () => closeRemoteScreenStream(incomingCall.peer));
                incomingCall.on("error", () => closeRemoteScreenStream(incomingCall.peer));
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
    }, [socket, peerHost, peerPort, peerPath, peerSecure, closeRemoteScreenStream]);

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

    const handleRoomScreenPeerIds = useCallback((
        peers: Array<{ screenPeerId: string; alias: string }>
    ) => {
        peers.forEach(({ screenPeerId, alias }) => {
            allowedScreenPeerIds.current.add(screenPeerId);
            pendingAliasRef.current.set(screenPeerId, alias);
        });
        const stream = localStreamRef.current;
        if (stream) {
            peers.forEach(({ screenPeerId, alias }) => {
                console.log("Calling room member with screenshare:", alias);
                callPeerWithScreen(screenPeerId, stream);
            });
        }
    }, [callPeerWithScreen]);

    const handlePeerScreenshareStarted = useCallback((
        audioPeerId: string,
        alias: string,
        screenPeerId: string,
    ) => {
        console.log(`Peer ${alias} started screenshare with screen peer: ${screenPeerId}`);
        pendingAliasRef.current.set(screenPeerId, alias);
        peerScreenPeerIds.current.set(audioPeerId, screenPeerId);
        // Allowlist the screen peer ID so the incoming call handler accepts it.
        // The remote peer (or bot) is the caller and will send us an OFFER
        // we do not need to initiate anything here.
        allowedScreenPeerIds.current.add(screenPeerId);
    }, []);

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
            closeRemoteScreenStream(screenPeerId);
            peerScreenPeerIds.current.delete(audioPeerId);
        }
    }, [closeRemoteScreenStream]);

    const getAudioPeerIdForScreenPeer = useCallback((screenPeerId: string) => {
        for (const [audioPeerId, spid] of peerScreenPeerIds.current) {
            if (spid === screenPeerId) return audioPeerId;
        }
        return null;
    }, []);

    return {
        isSharing,
        localScreenStream,
        remoteScreenStreams,
        dismissedPeerIds,
        startScreenShare,
        stopScreenShare,
        dismissScreenShare,
        restoreScreenShare,
        handleRoomScreenPeerIds,
        handlePeerScreenshareStarted,
        handleRemoteScreenShareStopped,
        handleNewScreenPeer,
        screenPeerIdRef,
        getAudioPeerIdForScreenPeer,
    };
};

export default useScreenshare;