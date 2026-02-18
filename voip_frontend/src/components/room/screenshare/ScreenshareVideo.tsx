import { useEffect, useRef } from "react";
import { Monitor } from "lucide-react";

interface ScreenshareVideoProps {
    peerId: string;
    alias: string;
    stream: MediaStream;
}

export default function ScreenshareVideo({ peerId, alias, stream }: ScreenshareVideoProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        return () => {
            if (videoRef.current) videoRef.current.srcObject = null;
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