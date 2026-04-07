/**
 * useRemoteAudio
 *
 * Manages HTMLAudioElement lifecycle for all remote peer streams. Creates,
 * updates, and destroys audio elements as streams arrive and leave. Applies
 * volume changes reactively via the element's volume property.
 */

import { useEffect, useRef } from "react";
import type { RemoteStream } from "@/types/voip.types";

const useRemoteAudio = (streams: RemoteStream[], volumes: Record<string, number>): void => {
  const audioEls = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    const active = new Set(streams.map(s => s.peerId));

    audioEls.current.forEach((el, peerId) => {
      if (!active.has(peerId)) {
        el.srcObject = null;
        el.remove();
        audioEls.current.delete(peerId);
      }
    });

    streams.forEach(({ peerId, stream }) => {
      let el = audioEls.current.get(peerId);
      if (!el) {
        el = document.createElement("audio");
        el.autoplay = true;
        document.body.appendChild(el);
        audioEls.current.set(peerId, el);
      }
      if (el.srcObject !== stream) {
        el.srcObject = stream;
        el.play().catch(() => {});
      }
      el.volume = volumes[peerId] ?? 1;
    });
  }, [streams, volumes]);

  useEffect(() => {
    return () => {
      audioEls.current.forEach(el => {
        el.srcObject = null;
        el.remove();
      });
      audioEls.current.clear();
    };
  }, []);
};

export default useRemoteAudio;