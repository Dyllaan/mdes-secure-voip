/**
 * Owns per-peer volume state and localStorage persistence
 */
import { useState, useRef, useCallback } from "react";

const VOLUME_KEY = "talk:peer-volumes";

interface UsePeerVolumesReturn {
  volumes: Record<string, number>;
  volumeRef: React.MutableRefObject<Record<string, number>>;
  setVolume: (peerId: string, volume: number) => void;
  saveForAlias: (alias: string, volume: number) => void;
  loadSavedForPeer: (peerId: string, alias: string) => void;
  muteVolume: (peerId: string) => void;
  restoreVolume: (peerId: string) => void;
}

const usePeerVolumes = (): UsePeerVolumesReturn => {
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const volumeRef = useRef<Record<string, number>>({});
  const stashRef = useRef<Record<string, number>>({});

  const setVolume = useCallback((peerId: string, volume: number) => {
    volumeRef.current[peerId] = volume;
    setVolumes(prev => ({ ...prev, [peerId]: volume }));
  }, []);

  const saveForAlias = useCallback((alias: string, volume: number) => {
    try {
      const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}");
      saved[alias] = volume;
      localStorage.setItem(VOLUME_KEY, JSON.stringify(saved));
    } catch {}
  }, []);

  const loadSavedForPeer = useCallback((peerId: string, alias: string) => {
    if (volumeRef.current[peerId] !== undefined) return;
    try {
      const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}");
      if (saved[alias] !== undefined) setVolume(peerId, saved[alias]);
    } catch {}
  }, [setVolume]);

  const muteVolume = useCallback((peerId: string) => {
    stashRef.current[peerId] = volumeRef.current[peerId] ?? 1;
    setVolume(peerId, 0);
  }, [setVolume]);

  const restoreVolume = useCallback((peerId: string) => {
    const prev = stashRef.current[peerId] ?? 1;
    delete stashRef.current[peerId];
    setVolume(peerId, prev);
  }, [setVolume]);

  return {
    volumes,
    volumeRef,
    setVolume,
    saveForAlias,
    loadSavedForPeer,
    muteVolume,
    restoreVolume,
  };
};

export default usePeerVolumes;