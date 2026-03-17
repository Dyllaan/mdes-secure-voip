import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import type Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import type { SignalProtocolClient } from "@/utils/SignalProtocolClient";
import type { RemoteStream } from "./useVoIP";
import type { UserConnectedData } from "@/types/voip.types";

interface UseRoomOptions {
    socket: Socket | null;
    peer: Peer | null;
    signalClient: SignalProtocolClient | null;
    processedStream: MediaStream | null;
    roomId: string;
    onPeerJoined:  (peerId: string) => void;
    onPeerLeft:    (peerId: string) => void;
    onRoomCleared: () => void;
}

const useRoom = ({
    socket,
    peer,
    signalClient,
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

    // Only removes the stream entry does NOT close the connection.
    // Used by local PeerJS close/error events which can fire during normal
    // renegotiation (when a screenshare call opens to the same peer).
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
                console.log(`callPeer waiting - stream: ${!!processedStreamRef.current}, peer: ${!!peerRef.current}`);
                setTimeout(waitAndCall, 100);
                return;
            }

            console.log(`Calling peer ${peerId} with PeerJS`);
            const outgoingCall = peerRef.current.call(peerId, processedStreamRef.current);
            openConnectionsRef.current.set(peerId, outgoingCall);

            outgoingCall.on("stream", (remoteStream: MediaStream) => {
                console.log(`Got remote stream from ${peerId}, tracks: ${remoteStream.getAudioTracks().length}`);
                addRemoteStream(peerId, remoteStream);
            });

            outgoingCall.on("close", () => removeStream(peerId));
            outgoingCall.on("error", (error) => {
                console.error("Error calling peer", peerId, error);
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
            console.log("Received all-users:", users);

            onRoomCleared();
            users.forEach(({ peerId }) => onPeerJoined(peerId));
            setConnectedPeers(users);

            if (signalClient) {
                try {
                    await signalClient.joinRoom(roomId, users.map(u => u.userId));
                    setIsEncryptionReady(signalClient.isRoomReady());
                } catch (error) {
                    console.error("Failed to join encrypted room:", error);
                    setIsEncryptionReady(false);
                }
            }

            users.forEach(({ peerId, alias }) => {
                console.log(`Calling existing user: ${peerId} (${alias})`);
                callPeer(peerId);
            });
        };

        const handleUserConnected = ({ peerId, alias }: UserConnectedData) => {
            console.log(`New user connected: ${peerId} (${alias})`);
            onPeerJoined(peerId);
            setConnectedPeers(prev => prev.some(p => p.peerId === peerId) ? prev : [...prev, { peerId, alias }]);
            callPeer(peerId);
        };

        const handleUserDisconnected = (disconnectedPeerId: string) => {
            console.log("User disconnected:", disconnectedPeerId);
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
    }, [socket, signalClient, roomId, callPeer, onPeerJoined, onPeerLeft, onRoomCleared, closePeerConnection]);

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