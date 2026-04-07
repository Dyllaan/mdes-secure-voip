/**
 * useRoomSession
 *
 * Owns socket signalling for room membership and encryption setup.
 * Listens for all-users, user-connected, and user-disconnected socket events,
 * delegates audio call management to the callPeer and removeRemoteStream
 * functions provided by usePeerConnection, and initialises encryption via
 * roomClient. Nothing in this hook manages WebRTC connections directly.
 */

import { useState, useEffect } from "react";
import type { Socket } from "socket.io-client";
import type { RoomClient } from "@/utils/RoomClient";
import type { UserConnectedData } from "@/types/voip.types";

const BOT_USER_IDS = ["musicman"];

function isBotUser(userId?: string): boolean {
  if (!userId) return false;
  return BOT_USER_IDS.some(id => userId === id || userId.startsWith(id + "-"));
}

interface UseRoomSessionOptions {
  socket: Socket | null;
  roomId: string;
  roomClient: RoomClient | null;
  callPeer: (peerId: string) => void;
  removeRemoteStream: (peerId: string) => void;
}

interface UseRoomSessionReturn {
  connectedPeers: Array<{ peerId: string; alias: string }>;
  isEncryptionReady: boolean;
}

const useRoomSession = ({
  socket,
  roomId,
  roomClient,
  callPeer,
  removeRemoteStream,
}: UseRoomSessionOptions): UseRoomSessionReturn => {
  const [connectedPeers, setConnectedPeers] = useState<Array<{ peerId: string; alias: string }>>([]);
  const [isEncryptionReady, setIsEncryptionReady] = useState(false);

  useEffect(() => {
    if (!socket || !roomId) return;

    const handleAllUsers = async (
      users: Array<{ peerId: string; alias: string; userId: string }>
    ) => {
      setConnectedPeers(users);
      users.forEach(({ peerId, userId }) => {
        if (!isBotUser(userId)) callPeer(peerId);
      });
      if (!roomId.startsWith("ephemeral-") && roomClient) {
        try {
          await roomClient.joinRoom(roomId, users.map(u => u.userId));
          setIsEncryptionReady(roomClient.isRoomReady());
        } catch {
          setIsEncryptionReady(false);
        }
      }
    };

    const handleUserConnected = ({ peerId, alias, userId }: UserConnectedData) => {
      setConnectedPeers(prev =>
        prev.some(p => p.peerId === peerId) ? prev : [...prev, { peerId, alias }]
      );
      if (!isBotUser(userId)) callPeer(peerId);
    };

    const handleUserDisconnected = (peerId: string) => {
      setConnectedPeers(prev => prev.filter(p => p.peerId !== peerId));
      removeRemoteStream(peerId);
    };

    socket.on("all-users", handleAllUsers);
    socket.on("user-connected", handleUserConnected);
    socket.on("user-disconnected", handleUserDisconnected);

    return () => {
      socket.off("all-users", handleAllUsers);
      socket.off("user-connected", handleUserConnected);
      socket.off("user-disconnected", handleUserDisconnected);
      setConnectedPeers([]);
      setIsEncryptionReady(false);
    };
  }, [socket, roomId, roomClient, callPeer, removeRemoteStream]);

  return { connectedPeers, isEncryptionReady };
};

export default useRoomSession;