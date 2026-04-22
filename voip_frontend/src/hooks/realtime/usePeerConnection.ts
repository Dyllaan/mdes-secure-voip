/**
 * Manages the socket connection for VoIP
 */
import { useState, useRef, useCallback, useEffect } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import { optimiseBitrate } from "@/utils/realtime/OptimiseBitrate";
import type { RemoteStream } from "@/types/voip.types";
import useIceServers from "./useIceServers";
import { getAccessToken } from "@/axios/api";
import { getAppE2EHarness } from "@/testing/e2eHarness";

interface PeerConfig {
  host: string;
  secure: boolean;
  port: number;
  path: string;
}

interface UsePeerConnectionOptions {
  stream: MediaStream | null;
  peerId: string;
  peerConfig: PeerConfig;
}

interface UsePeerConnectionReturn {
  remoteStreams: RemoteStream[];
  callPeer: (peerId: string) => void;
  removeRemoteStream: (peerId: string) => void;
  closeAll: () => void;
  waitForOpen: () => Promise<boolean>;
}

const usePeerConnection = ({
  stream,
  peerId,
  peerConfig,
}: UsePeerConnectionOptions): UsePeerConnectionReturn => {
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isOpenRef = useRef(false);
  const connectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const iceServers = useIceServers();
  const e2eHarness = getAppE2EHarness();

  useEffect(() => { streamRef.current = stream; }, [stream]);

  const addRemoteStream = useCallback((id: string, s: MediaStream) => {
    setRemoteStreams(prev =>
      prev.some(r => r.peerId === id) ? prev : [...prev, { peerId: id, stream: s }]
    );
  }, []);

  const removeRemoteStream = useCallback((id: string) => {
    const conn = connectionsRef.current.get(id);
    if (conn) {
      try { conn.close(); } catch {}
      connectionsRef.current.delete(id);
    }
    setRemoteStreams(prev => prev.filter(r => r.peerId !== id));
  }, []);

  const closeAll = useCallback(() => {
    connectionsRef.current.forEach(c => { try { c.close(); } catch {} });
    connectionsRef.current.clear();
    setRemoteStreams([]);
  }, []);

  const waitForOpen = useCallback((): Promise<boolean> => {
    return new Promise(resolve => {
      if (isOpenRef.current) { resolve(true); return; }
      let attempts = 0;
      const check = () => {
        if (isOpenRef.current) { resolve(true); return; }
        if (++attempts >= 40) { resolve(false); return; }
        setTimeout(check, 250);
      };
      setTimeout(check, 250);
    });
  }, []);

  const callPeer = useCallback((targetId: string) => {
    if (e2eHarness?.enabled) {
      return;
    }

    const attempt = () => {
      if (!streamRef.current || !peerRef.current?.open) {
        setTimeout(attempt, 100);
        return;
      }
      const call = peerRef.current.call(targetId, streamRef.current, {
        sdpTransform: optimiseBitrate,
      });
      connectionsRef.current.set(targetId, call);
      call.on("stream", s => addRemoteStream(targetId, s));
      call.on("close", () => removeRemoteStream(targetId));
      call.on("error", () => removeRemoteStream(targetId));
    };
    attempt();
  }, [addRemoteStream, removeRemoteStream, e2eHarness]);

  useEffect(() => {
    if (e2eHarness?.enabled) {
      if (!peerId) return;
      isOpenRef.current = true;
      const unregister = e2eHarness.registerAudioController({
        addRemoteStream: (id) => {
          const stream = new MediaStream();
          addRemoteStream(id, stream);
        },
        removeRemoteStream,
      });

      return () => {
        unregister();
        isOpenRef.current = false;
        closeAll();
        peerRef.current = null;
      };
    }

    if (!peerId || !stream || !iceServers) return;

    const p = new Peer(peerId, {
      host: peerConfig.host,
      secure: peerConfig.secure,
      port: peerConfig.port,
      path: peerConfig.path,
      debug: 1,
      token: getAccessToken() ?? '',
      config: { iceServers },
    });

    peerRef.current = p;

    p.on("open", () => { isOpenRef.current = true; });
    p.on("error", () => {});

    p.on("call", (incoming: MediaConnection) => {
      connectionsRef.current.set(incoming.peer, incoming);
      const answer = () => {
        if (streamRef.current) {
          incoming.answer(streamRef.current, { sdpTransform: optimiseBitrate });
        } else {
          setTimeout(answer, 100);
        }
      };
      answer();
      incoming.on("stream", s => addRemoteStream(incoming.peer, s));
      incoming.on("close", () => removeRemoteStream(incoming.peer));
      incoming.on("error", () => removeRemoteStream(incoming.peer));
    });

    return () => {
      isOpenRef.current = false;
      closeAll();
      p.destroy();
      peerRef.current = null;
    };
  }, [peerId, stream, iceServers, peerConfig.host, peerConfig.port, peerConfig.path, peerConfig.secure, addRemoteStream, removeRemoteStream, closeAll, e2eHarness]);

  return { remoteStreams, callPeer, removeRemoteStream, closeAll, waitForOpen };
};

export default usePeerConnection;
