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

            console.log("Audio setup for stream:", stream.id);
        } catch (err) {
            console.error("Failed to create audio nodes:", err);
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        return () => {
            console.log("Tearing down audio graph for stream:", stream.id);

            // Disconnect Web Audio nodes
            try { sourceRef.current?.disconnect(); }   catch {}
            try { gainNodeRef.current?.disconnect(); } catch {}

            audioContext.close().catch(() => {});

            sourceRef.current   = null;
            gainNodeRef.current = null;
            audioContextRef.current = null;
        };
    }, [stream]);

    useEffect(() => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume;
        }
    }, [volume]);

    return null;
}