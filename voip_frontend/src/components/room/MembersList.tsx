import { useVoIPContext } from "@/components/providers/VoIPProvider";
import { MicOff } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";

interface ContextMenu {
  peerId: string;
  label: string;
  x: number;
  y: number;
}

export default function MemberList() {
  const { connectedPeers, isVoiceActive, muted, setPeerVolume, peerVolumes } =
    useVoIPContext();
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, peerId: string, label: string) => {
      e.preventDefault();
      setContextMenu({ peerId, label, x: e.clientX, y: e.clientY });
    },
    []
  );

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  if (!isVoiceActive) return null;

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          <span className="truncate">You</span>
          {muted && <MicOff className="h-3 w-3 ml-auto text-red-400" />}
        </div>
        {connectedPeers.map(peer => (
          <div
            key={peer.peerId}
            onContextMenu={e =>
              handleContextMenu(
                e,
                peer.peerId,
                peer.alias || peer.peerId.slice(0, 12)
              )
            }
            className="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted/50 cursor-context-menu select-none"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            <span className="truncate">{peer.alias || peer.peerId.slice(0, 12)}</span>
            {(peerVolumes[peer.peerId] ?? 1) === 0 && (
              <MicOff className="h-3 w-3 ml-auto text-red-400" />
            )}
          </div>
        ))}
        {connectedPeers.length === 0 && (
          <p className="text-[11px] text-muted-foreground/60 px-2">
            Waiting for others to join...
          </p>
        )}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-2 shadow-md text-xs"
        >
          <p className="px-2 py-1 font-medium text-muted-foreground truncate mb-1">
            {contextMenu.label}
          </p>
          <div className="px-2 py-1 space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>Volume</span>
              <span>{Math.round((peerVolumes[contextMenu.peerId] ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={peerVolumes[contextMenu.peerId] ?? 1}
              onChange={e =>
                setPeerVolume(contextMenu.peerId, parseFloat(e.target.value))
              }
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/60">
              <span>Mute</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}