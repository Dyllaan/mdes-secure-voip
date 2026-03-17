import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import config from '@/config/config';

export interface MusicmanStatus {
  active:     boolean;
  roomId:     string;
  youtubeUrl: string;
}

const useMusicman = () => {
  const { user } = useAuth();
  const [activeRooms, setActiveRooms] = useState<Map<string, string>>(new Map());
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const fetchMusicman = useCallback(async (
    path:    string,
    options: RequestInit = {},
  ) => {
    const res = await fetch(`${config.MUSICMAN_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user?.accessToken}`,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(body.error ?? `Request failed [${res.status}]`);
    }
    if (res.status === 204) return null;
    return res.json();
  }, [user?.accessToken]);

  const joinHub = useCallback(async (hubId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/hub/join', {
        method: 'POST',
        body:   JSON.stringify({ hubId }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman]);

  const join = useCallback(async (
    roomId:     string,
    youtubeUrl: string,
  ): Promise<void> => {
    if (activeRooms.has(roomId)) return;
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/join', {
        method: 'POST',
        body:   JSON.stringify({ roomId, youtubeUrl }),
      });
      setActiveRooms(prev => new Map(prev).set(roomId, youtubeUrl));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman, activeRooms]);

  const leave = useCallback(async (roomId: string): Promise<void> => {
    if (!activeRooms.has(roomId)) return;
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/leave', {
        method: 'POST',
        body:   JSON.stringify({ roomId }),
      });
      setActiveRooms(prev => {
        const next = new Map(prev);
        next.delete(roomId);
        return next;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman, activeRooms]);

  const syncRooms = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data: { rooms: string[] } = await fetchMusicman('/rooms');
      setActiveRooms(prev => {
        const next = new Map<string, string>();
        for (const roomId of data.rooms) {
          next.set(roomId, prev.get(roomId) ?? '');
        }
        return next;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman]);

  const isActive = useCallback(
    (roomId: string) => activeRooms.has(roomId),
    [activeRooms],
  );

  const nowPlaying = useCallback(
    (roomId: string) => activeRooms.get(roomId) ?? null,
    [activeRooms],
  );

  return {
    joinHub,
    join,
    leave,
    syncRooms,
    activeRooms,
    loading,
    error,
    isActive,
    nowPlaying,
  };
};

export default useMusicman;