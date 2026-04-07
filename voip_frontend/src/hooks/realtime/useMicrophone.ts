/**
 * useMicrophone
 *
 * Owns the local microphone stream lifecycle.
 * Acquires getUserMedia on demand, manages mute state by toggling track.enabled,
 * and releases all tracks cleanly. Nothing in this hook knows about peers,
 * rooms, or WebRTC connections.
 */

import { useState, useRef, useCallback, useEffect } from "react";

interface UseMicrophoneReturn {
  stream: MediaStream | null;
  isReady: boolean;
  isMuted: boolean;
  acquire: () => Promise<boolean>;
  release: () => void;
  toggleMute: () => void;
}

const useMicrophone = (): UseMicrophoneReturn => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  const acquire = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
        },
      });
      streamRef.current = s;
      setStream(s);
      return true;
    } catch {
      return false;
    }
  }, []);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStream(null);
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    tracks.forEach(t => { t.enabled = isMuted; });
    setIsMuted(prev => !prev);
  }, [isMuted]);

  useEffect(() => () => { release(); }, [release]);

  return { stream, isReady: !!stream, isMuted, acquire, release, toggleMute };
};

export default useMicrophone;