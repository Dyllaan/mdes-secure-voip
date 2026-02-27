import { useEffect, useRef } from "react";
import type { AudioConfig } from "@/types/voip.types";

declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

export default function AudioWithVolume({ stream, volume }: AudioConfig) {
    const audioContextRef = useRef<AudioContext | null>(null);
    const gainNodeRef     = useRef<GainNode | null>(null);
    const sourceRef       = useRef<MediaStreamAudioSourceNode | null>(null);
    const mergerRef       = useRef<ChannelMergerNode | null>(null);

    useEffect(() => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        audioContextRef.current = audioContext;

        try {
            const source   = audioContext.createMediaStreamSource(stream);
            const gainNode = audioContext.createGain();
            const splitter = audioContext.createChannelSplitter(2);
            const merger   = audioContext.createChannelMerger(2);

            source.connect(splitter);
            splitter.connect(merger, 0, 0);
            splitter.connect(merger, 0, 1);
            merger.connect(gainNode);
            gainNode.connect(audioContext.destination);

            gainNode.gain.value = volume;

            sourceRef.current   = source;
            gainNodeRef.current = gainNode;
            mergerRef.current   = merger;

            console.log("Audio setup for stream:", stream.id);
        } catch (err) {
            console.error("Failed to create audio nodes:", err);
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        return () => {
            console.log("Tearing down audio graph for stream:", stream.id);
            try { mergerRef.current?.disconnect(); }  catch {}
            try { sourceRef.current?.disconnect(); }  catch {}
            try { gainNodeRef.current?.disconnect(); } catch {}
            audioContext.close().catch(() => {});
            sourceRef.current   = null;
            gainNodeRef.current = null;
            mergerRef.current   = null;
            audioContextRef.current = null;
        };
    }, [stream]);

    useEffect(() => {
        if (!gainNodeRef.current || !mergerRef.current || !audioContextRef.current) return;
        if (volume === 0) {
            try { mergerRef.current.disconnect(); } catch {}
        } else {
            try { mergerRef.current.connect(gainNodeRef.current); } catch {}
            gainNodeRef.current.gain.setTargetAtTime(volume, audioContextRef.current.currentTime, 0.01);
        }
    }, [volume]);

    return null;
}