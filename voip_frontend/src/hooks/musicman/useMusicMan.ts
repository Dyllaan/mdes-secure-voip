import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import config from '@/config/config';

export interface MusicmanStatus {
  active:     boolean;
  roomId:     string;
  youtubeUrl: string;
}

export interface PlaybackStatus {
  playing:    boolean;
  paused:     boolean;
  positionMs: number;
  youtubeUrl: string;
}

export interface ResolvedItem {
  id:         string;
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

  /** Legacy join — returns 409 if bot already in room. Prefer play() for track changes. */
  const join = useCallback(async (
    roomId:     string,
    youtubeUrl: string,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/join', {
        method: 'POST',
        body:   JSON.stringify({ roomId, youtubeUrl }),
      });
      setActiveRooms(prev => new Map(prev).set(roomId, youtubeUrl));
      setPausedRooms(prev => { const s = new Set(prev); s.delete(roomId); return s; });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchMusicman]);

  /**
   * Play a YouTube URL in a room. If the bot is not yet in the room it joins first;
   * if it's already there the track is swapped without disrupting connections.
   */
  const play = useCallback(async (
    roomId:     string,
    youtubeUrl: string,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/play', {
        method: 'POST',
        body:   JSON.stringify({ roomId, youtubeUrl }),
      });
      setActiveRooms(prev => new Map(prev).set(roomId, youtubeUrl));
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

  /** Seek to a position. Does not set a loading spinner — seek can be called frequently. */
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

  /** Fetch current playback status for a room. Returns null on error (e.g. no bot active). */
  const getStatus = useCallback(async (roomId: string): Promise<PlaybackStatus | null> => {
    try {
      return await fetchMusicman(`/status/${encodeURIComponent(roomId)}`);
    } catch {
      return null;
    }
  }, [fetchMusicman]);

  /**
   * Resolve a YouTube URL (single video or playlist) to individual video items.
   * Uses yt-dlp on the server so playlists expand into their constituent tracks.
   */
  const resolve = useCallback(async (url: string): Promise<ResolvedItem[]> => {
    const data: { items: ResolvedItem[] } = await fetchMusicman('/resolve', {
      method: 'POST',
      body:   JSON.stringify({ url }),
    });
    return data.items;
  }, [fetchMusicman]);

  const isActive = useCallback(
    (roomId: string) => activeRooms.has(roomId),
    [activeRooms],
  );

  const nowPlaying = useCallback(
    (roomId: string) => activeRooms.get(roomId) ?? null,
    [activeRooms],
  );

  const isPaused = useCallback(
    (roomId: string) => pausedRooms.has(roomId),
    [pausedRooms],
  );

  return {
    joinHub,
    join,
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
