import { useState, useCallback } from 'react';
import { useAuth } from "@/hooks/auth/useAuth";

import config from '@/config/config';


interface PlaybackStatus {
  playing:      boolean;
  paused:       boolean;
  positionMs:   number;
  url:   string;
  videoMode:    boolean;
  screenPeerId: string | null;
}

interface ResolvedItem {
  id:         string;
  url:        string;
  title:      string;
  channel:    string;
  duration:   string;
  durationMs: number;
}

const useMusicman = () => {
  const { user } = useAuth();
  const [activeRooms, setActiveRooms] = useState<Map<string, string>>(new Map());
  const [pausedRooms, setPausedRooms] = useState<Set<string>>(new Set());
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

  /**
   * Play a YouTube/SoundCloud URL in a room. If the bot is not yet in the room
   * it joins first
   * if it's already there the track is swapped
   *
   * videoMode streams the video as a peer screenshare WITH AUDIO
   * @TODO: to change the bot must be kicked and re-added to the room make this smoother by allowing videoMode to be toggled without leaving the room
   */
  const play = useCallback(async (
    roomId:     string,
    url: string,
    videoMode = false,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/play', {
        method: 'POST',
        body:   JSON.stringify({ roomId, url, videoMode }),
      });
      setActiveRooms(prev => new Map(prev).set(roomId, url));
      setPausedRooms(prev => { const s = new Set(prev); s.delete(roomId); return s; });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman]);

  const leave = useCallback(async (roomId: string): Promise<void> => {
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
      setPausedRooms(prev => { const s = new Set(prev); s.delete(roomId); return s; });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman, activeRooms]);

  const pause = useCallback(async (roomId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/pause', {
        method: 'POST',
        body:   JSON.stringify({ roomId }),
      });
      setPausedRooms(prev => new Set(prev).add(roomId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman]);

  const resume = useCallback(async (roomId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/resume', {
        method: 'POST',
        body:   JSON.stringify({ roomId }),
      });
      setPausedRooms(prev => { const s = new Set(prev); s.delete(roomId); return s; });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman]);

  /** Seek to a position. Does not set a loading spinner - seek can be called frequently. */
  const seek = useCallback(async (roomId: string, seconds: number): Promise<void> => {
    setError(null);
    try {
      await fetchMusicman('/seek', {
        method: 'POST',
        body:   JSON.stringify({ roomId, seconds }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [fetchMusicman]);

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

  /** Fetch current playback status for a room.
   *  Also syncs activeRooms so isActive() returns true for rooms where the bot is playing
   */
  const getStatus = useCallback(async (roomId: string): Promise<PlaybackStatus | null> => {
    try {
      const status = await fetchMusicman(`/status/${encodeURIComponent(roomId)}`);
      if (status?.playing) {
        setActiveRooms(prev => prev.has(roomId) ? prev : new Map(prev).set(roomId, status.url));
      }
      return status;
    } catch {
      return null;
    }
  }, [fetchMusicman]);

  /**
   * Resolve a YouTube/SoundCloud URL to individual track items via yt-dlp on the server.
   */
  const resolve = useCallback(async (url: string): Promise<ResolvedItem[]> => {
    const data: { items: ResolvedItem[] } = await fetchMusicman('/resolve', {
      method: 'POST',
      body:   JSON.stringify({ url }),
    });
    return data.items;
  }, [fetchMusicman]);

  const isActive   = useCallback((roomId: string) => activeRooms.has(roomId), [activeRooms]);
  const nowPlaying = useCallback((roomId: string) => activeRooms.get(roomId) ?? null, [activeRooms]);
  const isPaused   = useCallback((roomId: string) => pausedRooms.has(roomId), [pausedRooms]);

  return {
    joinHub,
    play,
    leave,
    pause,
    resume,
    seek,
    syncRooms,
    getStatus,
    resolve,
    activeRooms,
    pausedRooms,
    loading,
    error,
    isActive,
    nowPlaying,
    isPaused,
  };
};

export default useMusicman;