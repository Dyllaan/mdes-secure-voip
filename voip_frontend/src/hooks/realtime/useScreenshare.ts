import { useState, useRef, useCallback, useEffect } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import type { Socket } from "socket.io-client";
import useIceServers from "./useIceServers";

interface RemoteScreenStream {
  peerId: string;
  alias: string;
  stream: MediaStream;
}

interface UseScreenShareOptions {
  socket: Socket | null;
  currentRoomId: string | null;
  peerHost: string;
  peerPort: number;
  peerPath: string;
  peerSecure: boolean;
  onAudioPeerDismissed: (audioPeerId: string) => void;
  onAudioPeerRestored: (audioPeerId: string) => void;
}

const useScreenshare = ({
  socket,
  currentRoomId,
  peerHost,
  peerPort,
  peerPath,
  peerSecure,
  onAudioPeerDismissed,
  onAudioPeerRestored,
}: UseScreenShareOptions) => {
  const [isSharing, setIsSharing] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<RemoteScreenStream[]>([]);
  const [dismissedPeerIds, setDismissedPeerIds] = useState<Set<string>>(new Set());

  const screenPeerRef = useRef<Peer | null>(null);
  const screenPeerIdRef = useRef<string | null>(null);
  const screenCallsRef = useRef<Map<string, MediaConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const currentRoomIdRef = useRef<string | null>(currentRoomId);
  const isSharingRef = useRef(false);
  const screenAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const allowedScreenPeerIds = useRef<Set<string>>(new Set());
  const peerScreenPeerIds = useRef<Map<string, string>>(new Map());
  const pendingAliasRef = useRef<Map<string, string>>(new Map());
  const pendingCallsRef = useRef<Map<string, MediaConnection>>(new Map());
  const iceServers = useIceServers();
  const iceServersRef = useRef(iceServers);

  useEffect(() => { currentRoomIdRef.current = currentRoomId; }, [currentRoomId]);
  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { iceServersRef.current = iceServers; }, [iceServers]);

  const clearRoomState = useCallback(() => {
    allowedScreenPeerIds.current.clear();
    peerScreenPeerIds.current.clear();
    pendingAliasRef.current.clear();
    pendingCallsRef.current.forEach(call => { try { call.close(); } catch {} });
    pendingCallsRef.current.clear();
    screenCallsRef.current.forEach(call => { try { call.close(); } catch {} });
    screenCallsRef.current.clear();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenAudioElsRef.current.forEach(el => { el.srcObject = null; });
    screenAudioElsRef.current.clear();
    setRemoteScreenStreams([]);
    setDismissedPeerIds(new Set());
    setLocalScreenStream(null);
    setIsSharing(false);
  }, []);

  const getAudioPeerIdForScreenPeer = useCallback((screenPeerId: string): string | null => {
    for (const [audioPeerId, spid] of peerScreenPeerIds.current) {
      if (spid === screenPeerId) return audioPeerId;
    }
    return null;
  }, []);

  const closeRemoteScreenStream = useCallback((screenPeerId: string) => {
    setRemoteScreenStreams(prev => prev.filter(rs => rs.peerId !== screenPeerId));
    setDismissedPeerIds(prev => {
      const next = new Set(prev);
      next.delete(screenPeerId);
      return next;
    });
    pendingAliasRef.current.delete(screenPeerId);
    allowedScreenPeerIds.current.delete(screenPeerId);
    const call = screenCallsRef.current.get(screenPeerId);
    if (call) {
      try { call.close(); } catch {}
      screenCallsRef.current.delete(screenPeerId);
    }
    const audioEl = screenAudioElsRef.current.get(screenPeerId);
    if (audioEl) {
      audioEl.srcObject = null;
      screenAudioElsRef.current.delete(screenPeerId);
    }
  }, []);

  const dismissScreenShare = useCallback((screenPeerId: string) => {
    setDismissedPeerIds(prev => new Set([...prev, screenPeerId]));
    const audioEl = screenAudioElsRef.current.get(screenPeerId);
    if (audioEl) audioEl.muted = true;
    const audioPeerId = getAudioPeerIdForScreenPeer(screenPeerId);
    if (audioPeerId) onAudioPeerDismissed(audioPeerId);
  }, [getAudioPeerIdForScreenPeer, onAudioPeerDismissed]);

  const restoreScreenShare = useCallback((screenPeerId: string) => {
    setDismissedPeerIds(prev => {
      const next = new Set(prev);
      next.delete(screenPeerId);
      return next;
    });
    const audioEl = screenAudioElsRef.current.get(screenPeerId);
    if (audioEl) audioEl.muted = false;
    const audioPeerId = getAudioPeerIdForScreenPeer(screenPeerId);
    if (audioPeerId) onAudioPeerRestored(audioPeerId);
  }, [getAudioPeerIdForScreenPeer, onAudioPeerRestored]);

  const callPeerWithScreen = useCallback((screenPeerIdOfTarget: string, stream: MediaStream) => {
    const screenPeer = screenPeerRef.current;
    if (!screenPeer) return;
    const call = screenPeer.call(screenPeerIdOfTarget, stream);
    screenCallsRef.current.set(screenPeerIdOfTarget, call);
    call.on("error", err =>
      console.error("Screenshare call error to", screenPeerIdOfTarget, err)
    );
  }, []);

  const answerCall = useCallback((incomingCall: MediaConnection) => {
    incomingCall.answer();
    screenCallsRef.current.set(incomingCall.peer, incomingCall);
    incomingCall.on("stream", (remoteStream: MediaStream) => {
      const alias = pendingAliasRef.current.get(incomingCall.peer) ?? incomingCall.peer;
      if (remoteStream.getAudioTracks().length > 0) {
        const existing = screenAudioElsRef.current.get(incomingCall.peer);
        if (existing) { existing.srcObject = null; }
        const audioEl = new Audio();
        audioEl.srcObject = remoteStream;
        audioEl.autoplay = true;
        audioEl.play().catch(e => console.warn("Screen audio autoplay blocked:", e));
        screenAudioElsRef.current.set(incomingCall.peer, audioEl);
      }
      setRemoteScreenStreams(prev =>
        prev.some(rs => rs.peerId === incomingCall.peer)
          ? prev.map(rs =>
              rs.peerId === incomingCall.peer
                ? { ...rs, stream: remoteStream }
                : rs
            )
          : [...prev, { peerId: incomingCall.peer, alias, stream: remoteStream }]
      );
      setDismissedPeerIds(prev => {
        const next = new Set(prev);
        next.delete(incomingCall.peer);
        return next;
      });
    });
    incomingCall.on("close", () => closeRemoteScreenStream(incomingCall.peer));
    incomingCall.on("error", () => closeRemoteScreenStream(incomingCall.peer));
  }, [closeRemoteScreenStream]);

  const stopScreenShare = useCallback(() => {
    if (!socket || !currentRoomIdRef.current) return;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenCallsRef.current.forEach(call => { try { call.close(); } catch {} });
    screenCallsRef.current.clear();
    setLocalScreenStream(null);
    setIsSharing(false);
    socket.emit("screenshare-stopped", { roomId: currentRoomIdRef.current });
  }, [socket]);

  const startScreenShare = useCallback(async () => {
    if (!socket || !currentRoomIdRef.current || !screenPeerRef.current) return;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      localStreamRef.current = screenStream;
      setLocalScreenStream(screenStream);
      setIsSharing(true);
      socket.emit("screenshare-started", {
        roomId: currentRoomIdRef.current,
        screenPeerId: screenPeerIdRef.current,
      });
      screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (err: any) {
      if (err.name !== "NotAllowedError") {
        console.error("Failed to start screen share:", err);
      }
    }
  }, [socket, stopScreenShare]);

  useEffect(() => {
    if (!socket) return;

    socket.emit("request-screen-peer-id");

    let retryTid: ReturnType<typeof setTimeout> | null = null;

    const handleScreenPeerAssigned = ({ peerId }: { peerId: string }) => {
      console.log("[screenshare] screen-peer-assigned received, peerId:", peerId);
      const tryInit = () => {
        if (!iceServersRef.current) {
          retryTid = setTimeout(tryInit, 100);
          return;
        }
        retryTid = null;
        const screenPeer = new Peer(peerId, {
          host: peerHost,
          secure: peerSecure,
          port: peerPort,
          path: peerPath,
          debug: 1,
          config: { iceServers: iceServersRef.current },
        });

        screenPeer.on("open", id => {
          console.log("[screenshare] screen Peer open, registered id:", id);
          screenPeerIdRef.current = id;
        });

        screenPeer.on("call", (incomingCall: MediaConnection) => {
          console.log("[screenshare] incoming call from:", incomingCall.peer, "allowed:", allowedScreenPeerIds.current.has(incomingCall.peer));
          if (!allowedScreenPeerIds.current.has(incomingCall.peer)) {
            console.warn("[screenshare] call queued - peer not yet in allowlist:", incomingCall.peer);
            pendingCallsRef.current.set(incomingCall.peer, incomingCall);
            return;
          }
          answerCall(incomingCall);
        });

        screenPeer.on("error", err => console.error("[screenshare] screen Peer error:", err));
        screenPeerRef.current = screenPeer;
      };
      tryInit();
    };

    const handleRoomScreenPeers = ({
      peers,
    }: {
      peers: Array<{ screenPeerId: string; alias: string }>;
    }) => {
      console.log("[screenshare] room-screen-peers received:", peers);
      peers.forEach(({ screenPeerId, alias }) => {
        allowedScreenPeerIds.current.add(screenPeerId);
        pendingAliasRef.current.set(screenPeerId, alias);
      });
      const stream = localStreamRef.current;
      if (stream) {
        peers.forEach(({ screenPeerId }) => callPeerWithScreen(screenPeerId, stream));
      }
    };

    const handlePeerScreenshareStarted = ({
      peerId,
      alias,
      screenPeerId,
    }: {
      peerId: string;
      alias: string;
      screenPeerId: string;
    }) => {
      console.log("[screenshare] peer-screenshare-started - peerId:", peerId, "alias:", alias, "screenPeerId:", screenPeerId);
      pendingAliasRef.current.set(screenPeerId, alias);
      peerScreenPeerIds.current.set(peerId, screenPeerId);
      allowedScreenPeerIds.current.add(screenPeerId);
      console.log("[screenshare] allowlist now:", [...allowedScreenPeerIds.current]);

      const pending = pendingCallsRef.current.get(screenPeerId);
      if (pending) {
        console.log("[screenshare] draining pending call from:", screenPeerId);
        pendingCallsRef.current.delete(screenPeerId);
        answerCall(pending);
      }
    };

    const handlePeerScreenshareStopped = ({ peerId }: { peerId: string }) => {
      const screenPeerId = peerScreenPeerIds.current.get(peerId);
      if (screenPeerId) {
        closeRemoteScreenStream(screenPeerId);
        peerScreenPeerIds.current.delete(peerId);
      }
    };

    const handleNewScreenPeer = ({
      screenPeerId,
    }: {
      screenPeerId: string;
      alias: string;
    }) => {
      const stream = localStreamRef.current;
      if (!stream || !isSharingRef.current) return;
      callPeerWithScreen(screenPeerId, stream);
    };

    socket.on("screen-peer-assigned", handleScreenPeerAssigned);
    socket.on("room-screen-peers", handleRoomScreenPeers);
    socket.on("peer-screenshare-started", handlePeerScreenshareStarted);
    socket.on("peer-screenshare-stopped", handlePeerScreenshareStopped);
    socket.on("new-screen-peer", handleNewScreenPeer);

    return () => {
      if (retryTid) clearTimeout(retryTid);
      socket.off("screen-peer-assigned", handleScreenPeerAssigned);
      socket.off("room-screen-peers", handleRoomScreenPeers);
      socket.off("peer-screenshare-started", handlePeerScreenshareStarted);
      socket.off("peer-screenshare-stopped", handlePeerScreenshareStopped);
      socket.off("new-screen-peer", handleNewScreenPeer);
      screenPeerRef.current?.destroy();
      screenPeerRef.current = null;
      screenPeerIdRef.current = null;
    };
  }, [socket, peerHost, peerPort, peerPath, peerSecure, answerCall, closeRemoteScreenStream, callPeerWithScreen]);

  return {
    isSharing,
    localScreenStream,
    remoteScreenStreams,
    dismissedPeerIds,
    startScreenShare,
    stopScreenShare,
    dismissScreenShare,
    restoreScreenShare,
    clearRoomState,
  };
};

export default useScreenshare;