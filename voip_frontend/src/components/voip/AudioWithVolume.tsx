import { useEffect, useRef } from "react";
import type { AudioConfig } from "@/types/voip.types";

// Type declaration for webkit prefixed API
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

export default function AudioWithVolume({ stream, volume }: AudioConfig) {
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);

    useEffect(() => {
        // Create AudioContext on first mount
        if (!audioContextRef.current) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioContextRef.current = new AudioContextClass();
        }

        const audioContext = audioContextRef.current;

        // Create audio nodes on first mount
        if (!sourceRef.current || !gainNodeRef.current) {
            try {
                const source = audioContext.createMediaStreamSource(stream);
                const gainNode = audioContext.createGain();

                // FIX: Create a channel merger to ensure stereo output
                const merger = audioContext.createChannelMerger(2);
                const splitter = audioContext.createChannelSplitter(2);
                
                source.connect(splitter);
                
                // Route both channels to both output channels (mono->stereo)
                splitter.connect(merger, 0, 0); // Left input -> Left output
                splitter.connect(merger, 0, 1); // Left input -> Right output
                
                merger.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                sourceRef.current = source;
                gainNodeRef.current = gainNode;
                console.log('Audio setup with stereo routing');
            } catch (err) {
                console.error("Failed to create audio nodes:", err);
                return;
            }
        }

        // Update volume
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.value = volume;
        }

        // Resume context if suspended
        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        return () => {
            // Cleanup if needed when component unmounts
        };
    }, [stream, volume]);

    return null;
}