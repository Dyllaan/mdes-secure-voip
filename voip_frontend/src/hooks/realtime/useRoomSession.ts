/**
 * Owns socket signalling for room membership and encryption setup
 */

import { useState, useEffect } from "react";
import type { Socket } from "socket.io-client";
import type { RoomClient } from "@/utils/crypto/RoomClient";
import type { UserConnectedData } from "@/types/voip.types";

const BOT_ALIASES = ["musicman"];

function isBotAlias(alias?: string): boolean {
  if (!alias) return false;
  return BOT_ALIASES.some(a => alias === a || alias.startsWith(a + "-"));
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
      users.forEach(({ peerId }) => {
        callPeer(peerId);
      });
      if (!roomId.startsWith("ephemeral-") && roomClient) {
        try {
          await roomClient.joinRoom(roomId, users.filter(u => !isBotAlias(u.alias)).map(u => u.userId));
          setIsEncryptionReady(roomClient.isRoomReady());
        } catch {
          setIsEncryptionReady(false);
        }
      }
    };

    const handleUserConnected = ({ peerId, alias }: UserConnectedData) => {
      setConnectedPeers(prev =>
        prev.some(p => p.peerId === peerId) ? prev : [...prev, { peerId, alias }]
      );
      callPeer(peerId);
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