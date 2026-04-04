import { useEffect, useRef } from "react";
import { Monitor } from "lucide-react";

interface ScreenshareVideoProps {
    alias: string;
    stream: MediaStream;
}

export default function ScreenshareVideo({ alias, stream }: ScreenshareVideoProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        el.srcObject = stream;
        // Explicitly call play() — autoPlay attribute alone isn't reliable for
        // streams containing audio tracks (browser autoplay policy). The user has
        // already interacted with the page, so this should always succeed.
        el.play().catch(err => {
            // NotAllowedError means autoplay was blocked — surface it so the
            // user knows audio may be silent until they interact with the video.
            if (err.name !== 'AbortError') {
                console.warn('[ScreenshareVideo] play() blocked:', err);
            }
        });
        return () => {
            el.srcObject = null;
        };
    }, [stream]);

    return (
        <div className="relative w-full rounded-lg overflow-hidden bg-black border border-border"
             style={{ aspectRatio: "16 / 9" }}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                className="absolute inset-0 w-full h-full object-contain"
            />
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1">
                <Monitor className="h-3 w-3 text-white" />
                <span className="text-xs text-white font-medium">{alias} is sharing</span>
            </div>
        </div>
    );
}