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

  const openMenuFromButton = useCallback(
    (target: HTMLElement, peerId: string, label: string) => {
      const rect = target.getBoundingClientRect();
      setContextMenu({
        peerId,
        label,
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      });
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
          <button
            key={peer.peerId}
            onContextMenu={e =>
              handleContextMenu(
                e,
                peer.peerId,
                peer.alias || peer.peerId.slice(0, 12)
              )
            }
            onClick={(e) =>
              openMenuFromButton(
                e.currentTarget,
                peer.peerId,
                peer.alias || peer.peerId.slice(0, 12)
              )
            }
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50 cursor-context-menu select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={contextMenu?.peerId === peer.peerId}
            aria-label={`Open audio controls for ${peer.alias || peer.peerId.slice(0, 12)}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            <span className="truncate">{peer.alias || peer.peerId.slice(0, 12)}</span>
            {(peerVolumes[peer.peerId] ?? 1) === 0 && (
              <MicOff className="h-3 w-3 ml-auto text-red-400" />
            )}
          </button>
        ))}
        {connectedPeers.length === 0 && (
          <p className="text-[11px] text-muted-foreground px-2">
            Waiting for others to join...
          </p>
        )}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-2 shadow-md text-xs"
          role="dialog"
          aria-label={`Audio controls for ${contextMenu.label}`}
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
              aria-label={`Volume for ${contextMenu.label}`}
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
