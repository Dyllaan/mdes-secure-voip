import { useState, useCallback, useEffect } from "react";
import { signalingApi } from "@/axios/api";
import type { Socket } from "socket.io-client";

export interface RoomInfo {
  id: string;
  userCount: number;
}

const useRoomManager = (socket: Socket | null) => {
  const [rooms,   setRooms]   = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;
    socket.on("room-list", ({ rooms }: { rooms: RoomInfo[] }) => setRooms(rooms));
    return () => { socket.off("room-list"); };
  }, [socket]);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await signalingApi.get('/rooms');
      setRooms(res.data.rooms);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 15000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  const createRoom = useCallback(async (roomId?: string): Promise<RoomInfo | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await signalingApi.post('/rooms', roomId ? { roomId } : {});
      const newRoom: RoomInfo = { id: res.data.roomId, userCount: 0 };
      setRooms(prev => res.data.created ? [...prev, newRoom] : prev);
      return newRoom;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteRoom = useCallback(async (roomId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await signalingApi.delete(`/rooms/${roomId}`);
      setRooms(prev => prev.filter(r => r.id !== roomId));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    rooms,
    loading,
    error,
    fetchRooms,
    createRoom,
    deleteRoom,
  };
};

export default useRoomManager;