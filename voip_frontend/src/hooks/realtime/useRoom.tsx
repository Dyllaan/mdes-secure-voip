import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import type Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import type { RoomClient } from "@/utils/RoomClient";
import type { RemoteStream } from "./useVoIP";
import type { UserConnectedData } from "@/types/voip.types";

interface UseRoomOptions {
    socket: Socket | null;
    peer: Peer | null;
    roomClient: RoomClient | null;
    processedStream: MediaStream | null;
    roomId: string;
    onPeerJoined:  (peerId: string) => void;
    onPeerLeft:    (peerId: string) => void;
    onRoomCleared: () => void;
}

const useRoom = ({
    socket,
    peer,
    roomClient,
    processedStream,
    roomId,
    onPeerJoined,
    onPeerLeft,
    onRoomCleared,
}: UseRoomOptions) => {
    const [remoteStreams,     setRemoteStreams]     = useState<RemoteStream[]>([]);
    const [isEncryptionReady, setIsEncryptionReady] = useState<boolean>(false);
    const [connectedPeers, setConnectedPeers] = useState<Array<{ peerId: string; alias: string }>>([]);

    const processedStreamRef = useRef(processedStream);
    const peerRef            = useRef(peer);
    const openConnectionsRef = useRef<Map<string, MediaConnection>>(new Map());

    useEffect(() => { processedStreamRef.current = processedStream; }, [processedStream]);
    useEffect(() => { peerRef.current = peer; }, [peer]);

    const addRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
        setRemoteStreams(prev =>
            prev.some(rs => rs.peerId === peerId)
                ? prev
                : [...prev, { peerId, stream }]
        );
    }, []);

    const removeStream = useCallback((peerId: string) => {
        openConnectionsRef.current.delete(peerId);
        setRemoteStreams(prev => prev.filter(rs => rs.peerId !== peerId));
    }, []);

    const closePeerConnection = useCallback((peerId: string) => {
        const conn = openConnectionsRef.current.get(peerId);
        if (conn) {
            try { conn.close(); } catch {}
            openConnectionsRef.current.delete(peerId);
        }
        setRemoteStreams(prev => prev.filter(rs => rs.peerId !== peerId));
    }, []);

    const closeAllConnections = useCallback(() => {
        console.log(`Closing ${openConnectionsRef.current.size} peer connection(s)`);
        openConnectionsRef.current.forEach(conn => { try { conn.close(); } catch {} });
        openConnectionsRef.current.clear();
        setRemoteStreams([]);
    }, []);

    const callPeer = useCallback((peerId: string): void => {
        const waitAndCall = (): void => {
            if (!processedStreamRef.current || !peerRef.current) {
                console.log(`[callPeer] waiting for ${peerId} — stream: ${!!processedStreamRef.current}, peer: ${!!peerRef.current}`);
                setTimeout(waitAndCall, 100);
                return;
            }

            const stream = processedStreamRef.current;
            const audioTracks = stream.getAudioTracks();
            console.log(`[callPeer] calling ${peerId} — stream id: ${stream.id}, audioTracks: ${audioTracks.length}, active: ${stream.active}`);
            audioTracks.forEach((t, i) =>
                console.log(`[callPeer]   track[${i}]: id=${t.id} kind=${t.kind} enabled=${t.enabled} readyState=${t.readyState}`)
            );

            const outgoingCall = peerRef.current!.call(peerId, stream);
            openConnectionsRef.current.set(peerId, outgoingCall);

            outgoingCall.on("stream", (remoteStream: MediaStream) => {
                const aTracks = remoteStream.getAudioTracks();
                const vTracks = remoteStream.getVideoTracks();
                console.log(`[callPeer] stream from ${peerId} — audio: ${aTracks.length}, video: ${vTracks.length}`);
                aTracks.forEach((t, i) =>
                    console.log(`[callPeer]   audio[${i}]: id=${t.id} enabled=${t.enabled} readyState=${t.readyState} muted=${t.muted}`)
                );
                addRemoteStream(peerId, remoteStream);
            });

            outgoingCall.on("close", () => {
                console.log(`[callPeer] call closed by ${peerId}`);
                removeStream(peerId);
            });
            outgoingCall.on("error", (error) => {
                console.error(`[callPeer] error from ${peerId}:`, error);
                removeStream(peerId);
            });
        };
        waitAndCall();
    }, [addRemoteStream, removeStream]);

    const registerIncomingConnection = useCallback((peerId: string, conn: MediaConnection) => {
        openConnectionsRef.current.set(peerId, conn);
    }, []);

    useEffect(() => {
        if (!socket) return;

        const handleAllUsers = async (users: Array<{ peerId: string; alias: string; userId: string }>) => {
            onRoomCleared();
            users.forEach(({ peerId }) => onPeerJoined(peerId));
            setConnectedPeers(users);

            if (!roomId.startsWith('ephemeral-')) {
                users.forEach(({ peerId, alias }) => {
                    console.log(`[useRoom] all-users: calling ${peerId} (${alias})`);
                    callPeer(peerId);
                });
            }

            if (roomClient && roomId && !roomId.startsWith('ephemeral-')) {
                try {
                    await roomClient.joinRoom(roomId, users.map(u => u.userId));
                    setIsEncryptionReady(roomClient.isRoomReady());
                } catch (error) {
                    console.error("Failed to join encrypted room:", error);
                    setIsEncryptionReady(false);
                }
            }
        };

        const handleUserConnected = ({ peerId, alias }: UserConnectedData) => {
            console.log(`[useRoom] user-connected: ${peerId} (${alias})`);
            onPeerJoined(peerId);
            setConnectedPeers(prev => prev.some(p => p.peerId === peerId) ? prev : [...prev, { peerId, alias }]);
            if (!roomId.startsWith('ephemeral-')) {
                callPeer(peerId);
            }
        };

        const handleUserDisconnected = (disconnectedPeerId: string) => {
            console.log(`[useRoom] user-disconnected: ${disconnectedPeerId}`);
            onPeerLeft(disconnectedPeerId);
            setConnectedPeers(prev => prev.filter(p => p.peerId !== disconnectedPeerId));
            closePeerConnection(disconnectedPeerId);
        };

        socket.on("all-users",         handleAllUsers);
        socket.on("user-connected",    handleUserConnected);
        socket.on("user-disconnected", handleUserDisconnected);

        return () => {
            socket.off("all-users",         handleAllUsers);
            socket.off("user-connected",    handleUserConnected);
            socket.off("user-disconnected", handleUserDisconnected);
        };
    }, [socket, roomClient, roomId, callPeer, onPeerJoined, onPeerLeft, onRoomCleared, closePeerConnection]);

    useEffect(() => {
        if (!roomId) {
            closeAllConnections();
            setIsEncryptionReady(false);
            setConnectedPeers([]);
            onRoomCleared();
        }
    }, [roomId, closeAllConnections, onRoomCleared]);

    return {
        remoteStreams,
        isEncryptionReady,
        setIsEncryptionReady,
        connectedPeers,
        addRemoteStream,
        removeStream,
        registerIncomingConnection,
        closeAllConnections,
    };
};

export default useRoom;