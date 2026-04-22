import { useState, useRef, useEffect } from "react";
import { Monitor, Maximize2, Crown, ChevronDown, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHubLayout } from "@/contexts/HubLayoutContext";
import ScreenshareVideo from "@/components/room/screenshare/ScreenshareVideo";
import { toast } from "sonner";

interface ScreenEntry {
  id: string;
  stream: MediaStream;
  label: string;
  isLocal: boolean;
}

interface ScreenshareManagerProps {
  onHide: () => void;
}

function PrimaryVideo({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
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
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className="w-full h-full object-contain"
    />
  );
}

interface ThumbnailCardProps {
  entry: ScreenEntry;
  onPrioritise: () => void;
  onDismiss?: () => void;
}

function ThumbnailCard({ entry, onPrioritise, onDismiss }: ThumbnailCardProps) {
  return (
    <div
      className="relative w-full rounded-md overflow-hidden cursor-pointer group ring-1 ring-white/10 hover:ring-[#7ee8a2]/40 transition-all shrink-0"
      style={{ aspectRatio: "16 / 9" }}
      onClick={onPrioritise}
    >
      <ScreenshareVideo alias={entry.label} stream={entry.stream} />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors pointer-events-none rounded-md" />
      <div className="absolute top-1.5 right-1.5 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="p-1 rounded bg-black/70 hover:bg-[#7ee8a2]/30 text-white/70 hover:text-[#7ee8a2] transition-colors"
          title="Make primary"
          onClick={e => { e.stopPropagation(); onPrioritise(); }}
        >
          <Maximize2 className="h-2.5 w-2.5" />
        </button>
        {onDismiss && (
          <button
            className="p-1 rounded bg-black/70 hover:bg-black/90 text-white/70 hover:text-white transition-colors"
            title="Dismiss"
            onClick={e => { e.stopPropagation(); onDismiss(); }}
          >
            <EyeOff className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ScreenshareManager({ onHide }: ScreenshareManagerProps) {
  const {
    remoteScreenStreams,
    localScreenStream,
    isSharing,
    dismissScreenShare,
    restoreScreenShare,
    dismissedPeerIds,
  } = useHubLayout();

  const [prioritised, setPrioritised] = useState<string | null>(null);

  const allScreens: ScreenEntry[] = [
    ...(localScreenStream && isSharing
      ? [{ id: "__local__", stream: localScreenStream, label: "Your screen", isLocal: true }]
      : []),
    ...remoteScreenStreams.map(({ peerId, stream, alias }) => ({
      id: peerId,
      stream,
      label: alias || peerId,
      isLocal: false,
    })),
  ];

  const visibleScreens = allScreens.filter(s => !dismissedPeerIds.has(s.id));
  const dismissedScreens = allScreens.filter(s => dismissedPeerIds.has(s.id));

  useEffect(() => {
    if (visibleScreens.length === 0) { setPrioritised(null); return; }
    if (!visibleScreens.find(s => s.id === prioritised)) {
      setPrioritised(visibleScreens[0].id);
    }
  }, [visibleScreens.map(s => s.id).join(",")]);

  if (allScreens.length === 0) return null;

  const primary = visibleScreens.find(s => s.id === prioritised) ?? visibleScreens[0];
  const thumbnails = visibleScreens.filter(s => s.id !== primary?.id);

  return (
    <div className="w-full border-b border-white/5 bg-black/20">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.06]">
        <Monitor className="h-3.5 w-3.5 text-[#7ee8a2]" strokeWidth={1.5} />
        <span className="text-[11px] font-medium tracking-widest uppercase text-white/40 select-none">
          Screenshares
        </span>
        <span className="ml-1 text-[10px] text-white/20">{allScreens.length} active</span>
        {dismissedScreens.length > 0 && (
          <span className="text-[10px] text-white/20">· {dismissedScreens.length} hidden</span>
        )}
        <button
          className="ml-auto text-white/30 hover:text-white/60 transition-colors"
          onClick={onHide}
          title="Collapse"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {visibleScreens.length > 0 && primary && (
        <div className="flex gap-2 p-3 items-start">
          <div className="relative mx-auto flex-1 min-w-0" style={{ aspectRatio: "16 / 9", maxWidth: "min(100%, calc(45vh * 16 / 9))" }}>
            <div className="absolute inset-0 rounded-lg overflow-hidden bg-black ring-1 ring-[#7ee8a2]/20">
              <PrimaryVideo stream={primary.stream} muted={primary.isLocal} />

              <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded px-2 py-0.5 pointer-events-none">
                <Crown className="h-3 w-3 text-[#7ee8a2]" />
                <span className="text-[10px] text-[#7ee8a2] tracking-wide">
                  {primary.isLocal ? "You" : primary.label}
                </span>
              </div>

              {!primary.isLocal && (
                <div className="absolute top-2 right-2 z-10 opacity-0 hover:opacity-100 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 bg-black/70 hover:bg-black/90 text-white border-0 text-[10px] tracking-wide rounded"
                    onClick={() => dismissScreenShare(primary.id)}
                  >
                    <EyeOff className="h-3 w-3" /> Dismiss
                  </Button>
                </div>
              )}
            </div>
          </div>

          {thumbnails.length > 0 && (
            <div className="flex flex-col gap-2 w-40 shrink-0 overflow-y-auto" style={{ maxHeight: "45vh" }}>
              {thumbnails.map(entry => (
                <ThumbnailCard
                  key={entry.id}
                  entry={entry}
                  onPrioritise={() => setPrioritised(entry.id)}
                  onDismiss={!entry.isLocal ? () => dismissScreenShare(entry.id) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {dismissedScreens.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-white/[0.06]">
          <EyeOff className="h-3 w-3 text-white/20 shrink-0" />
          <span className="text-[10px] text-white/20 shrink-0">Tuned out:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {dismissedScreens.map(entry => (
              <button
                key={entry.id}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors text-[10px]"
                onClick={() => restoreScreenShare(entry.id)}
                title={`Tune back in to ${entry.isLocal ? "your screen" : entry.label}`}
              >
                <Eye className="h-2.5 w-2.5" />
                {entry.isLocal ? "You" : entry.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}