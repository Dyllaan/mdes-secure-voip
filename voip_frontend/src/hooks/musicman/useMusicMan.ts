import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import config from '@/config/config';

export interface MusicmanStatus {
  active:     boolean;
  roomId:     string;
  youtubeUrl: string;
}

export interface PlaybackStatus {
  playing:      boolean;
  paused:       boolean;
  positionMs:   number;
  youtubeUrl:   string;
  videoMode:    boolean;
  screenPeerId: string | null;
}

export interface ResolvedItem {
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
   * it joins first; if it's already there the track is swapped without
   * disrupting connections.
   *
   * videoMode streams the video as a peer screenshare in addition to audio.
   * It is locked at join time — changing it mid-session requires /leave + /play.
   */
  const play = useCallback(async (
    roomId:     string,
    youtubeUrl: string,
    videoMode = false,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await fetchMusicman('/play', {
        method: 'POST',
        body:   JSON.stringify({ roomId, youtubeUrl, videoMode }),
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

  /** Fetch current playback status for a room. Returns null on error (e.g. no bot active).
   *  Also syncs activeRooms so isActive() returns true for rooms where the bot is already
   *  playing (e.g. when the frontend joins a room where the bot was already running).
   */
  const getStatus = useCallback(async (roomId: string): Promise<PlaybackStatus | null> => {
    try {
      const status = await fetchMusicman(`/status/${encodeURIComponent(roomId)}`);
      if (status?.playing) {
        // Bot is active in this room — ensure activeRooms reflects it so isActive() works
        setActiveRooms(prev => prev.has(roomId) ? prev : new Map(prev).set(roomId, status.youtubeUrl));
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