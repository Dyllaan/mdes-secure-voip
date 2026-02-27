import { useState, useCallback, useEffect } from "react";
import config from "../config/config";
import { useAuth } from "@/hooks/useAuth";

export interface RoomInfo {
  id: string;
  userCount: number;
}

const useRoomManager = () => {
  const { user } = useAuth();
  const accessToken = user?.accessToken;

  const [rooms,   setRooms]   = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error,   setError]   = useState<string | null>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.SIGNALING_SERVER}/api/realtime/rooms`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) throw new Error("Failed to fetch rooms");
      const data = await res.json();
      setRooms(data.rooms);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 15000);
    console.log("Started room list polling");
    return () => clearInterval(interval);
  }, [fetchRooms]);

  const createRoom = useCallback(async (roomId?: string): Promise<RoomInfo | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.SIGNALING_SERVER}/api/realtime/rooms`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(roomId ? { roomId } : {}),
      });
      if (!res.ok) throw new Error("Failed to create room");
      const data = await res.json();
      const newRoom: RoomInfo = { id: data.roomId, userCount: 0 };
      setRooms(prev => data.created ? [...prev, newRoom] : prev);
      return newRoom;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const deleteRoom = useCallback(async (roomId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.SIGNALING_SERVER}/api/realtime/rooms/${roomId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete room");
      }
      setRooms(prev => prev.filter(r => r.id !== roomId));
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

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