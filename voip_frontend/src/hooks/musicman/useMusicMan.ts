import axios from 'axios';
import { useState, useCallback } from 'react';
import { musicmanApi, ApiError } from '@/axios/api';
import type { MusicQueueItem, MusicRoomState, MusicRoomStateEvent } from '@/components/music/types';

interface ResolvedItem extends MusicQueueItem {}

interface SessionResponse {
  ok: boolean;
  roomId: string;
  session: MusicRoomState | null;
}

const useMusicman = () => {
  const [roomStates, setRoomStates] = useState<Map<string, MusicRoomState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (
    path: string,
    options: { method?: string; data?: unknown } = {},
  ) => {
    const res = await musicmanApi.request({
      url: path,
      method: options.method ?? 'GET',
      data: options.data,
    });
    if (res.status >= 400) {
      throw new ApiError((res.data as { error?: string } | undefined)?.error ?? 'MusicMan request failed', res.status, res.data);
    }
    return res.data ?? null;
  }, []);

  const upsertRoomState = useCallback((state: MusicRoomState | null) => {
    if (!state) return;
    setRoomStates((prev) => {
      const next = new Map(prev);
      next.set(state.roomId, state);
      return next;
    });
  }, []);

  const clearRoomState = useCallback((roomId: string) => {
    setRoomStates((prev) => {
      if (!prev.has(roomId)) return prev;
      const next = new Map(prev);
      next.delete(roomId);
      return next;
    });
  }, []);

  const applySessionResponse = useCallback((payload: SessionResponse | null) => {
    if (!payload) return null;
    if (payload.session) {
      upsertRoomState(payload.session);
      return payload.session;
    }
    clearRoomState(payload.roomId);
    return null;
  }, [clearRoomState, upsertRoomState]);

  const applySessionStateEvent = useCallback((event: MusicRoomStateEvent) => {
    if (event.active && event.state) {
      upsertRoomState(event.state);
      return;
    }
    clearRoomState(event.roomId);
  }, [clearRoomState, upsertRoomState]);

  const joinHub = useCallback(async (hubId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await request('/hub/join', { method: 'POST', data: { hubId } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [request]);

  const play = useCallback(async (
    roomId: string,
    url: string,
    videoMode = false,
  ): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/play', { method: 'POST', data: { roomId, url, videoMode } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const addQueueItems = useCallback(async (
    roomId: string,
    items: MusicQueueItem[],
    videoMode = false,
  ): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/queue/add', { method: 'POST', data: { roomId, items, videoMode } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const playQueueItem = useCallback(async (roomId: string, itemId: string): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/queue/play', { method: 'POST', data: { roomId, itemId } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const removeQueueItem = useCallback(async (roomId: string, itemId: string): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/queue/remove', { method: 'POST', data: { roomId, itemId } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const clearQueue = useCallback(async (roomId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await request('/queue/clear', { method: 'POST', data: { roomId } });
      clearRoomState(roomId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [clearRoomState, request]);

  const reorderQueue = useCallback(async (roomId: string, items: MusicQueueItem[]): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/queue/reorder', {
        method: 'POST',
        data: { roomId, itemIds: items.map((item) => item.id) },
      }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const shuffleQueue = useCallback(async (roomId: string): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/queue/shuffle', { method: 'POST', data: { roomId } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const playNext = useCallback(async (roomId: string): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/queue/next', { method: 'POST', data: { roomId } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const leave = useCallback(async (roomId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await request('/leave', { method: 'POST', data: { roomId } });
      clearRoomState(roomId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [clearRoomState, request]);

  const pause = useCallback(async (roomId: string): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/pause', { method: 'POST', data: { roomId } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const resume = useCallback(async (roomId: string): Promise<MusicRoomState | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/resume', { method: 'POST', data: { roomId } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, request]);

  const seek = useCallback(async (roomId: string, seconds: number): Promise<MusicRoomState | null> => {
    setError(null);
    try {
      const data = await request('/seek', { method: 'POST', data: { roomId, seconds } }) as SessionResponse;
      return applySessionResponse(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    }
  }, [applySessionResponse, request]);

  const syncRooms = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data: { rooms: string[] } = await request('/rooms');
      setRoomStates((prev) => {
        const next = new Map(prev);
        for (const roomId of [...next.keys()]) {
          if (!data.rooms.includes(roomId)) next.delete(roomId);
        }
        return next;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [request]);

  const getStatus = useCallback(async (roomId: string): Promise<MusicRoomState | null> => {
    try {
      const status = await request(`/status/${encodeURIComponent(roomId)}`) as MusicRoomState | null;
      if (!status) {
        clearRoomState(roomId);
        return null;
      }
      upsertRoomState(status);
      return status;
    } catch (err: unknown) {
      if ((err instanceof ApiError && err.status === 404) || (axios.isAxiosError(err) && err.response?.status === 404)) {
        clearRoomState(roomId);
      }
      return null;
    }
  }, [clearRoomState, request, upsertRoomState]);

  const resolve = useCallback(async (url: string): Promise<ResolvedItem[]> => {
    const data: { items: ResolvedItem[] } = await request('/resolve', {
      method: 'POST',
      data: { url },
    });
    return data.items;
  }, [request]);

  const getRoomState = useCallback((roomId: string) => roomStates.get(roomId) ?? null, [roomStates]);
  const isActive = useCallback((roomId: string) => roomStates.has(roomId), [roomStates]);
  const nowPlaying = useCallback((roomId: string) => roomStates.get(roomId)?.currentTrack?.url ?? roomStates.get(roomId)?.url ?? null, [roomStates]);
  const isPaused = useCallback((roomId: string) => roomStates.get(roomId)?.paused ?? false, [roomStates]);

  return {
    joinHub,
    play,
    addQueueItems,
    playQueueItem,
    removeQueueItem,
    clearQueue,
    reorderQueue,
    shuffleQueue,
    playNext,
    leave,
    pause,
    resume,
    seek,
    syncRooms,
    getStatus,
    resolve,
    roomStates,
    loading,
    error,
    isActive,
    nowPlaying,
    isPaused,
    getRoomState,
    applySessionStateEvent,
  };
};

export default useMusicman;
