import { useEffect, useRef } from "react";
import { Monitor } from "lucide-react";
import { toast } from "sonner";

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
    el.play().catch(err => {
      if (err.name !== "AbortError") {
        toast.error("Playback blocked please leave and rejoin the channel to view the screenshare.");
      }
    });
    return () => { el.srcObject = null; };
  }, [stream]);

  return (
    <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: "16 / 9" }}>
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