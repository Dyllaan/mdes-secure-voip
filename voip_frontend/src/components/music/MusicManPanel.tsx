import { useState, useRef, useEffect } from 'react';
import { Music2, Play, Square, Loader2, ChevronDown, ChevronUp, Youtube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useMusicMan from '@/hooks/musicman/useMusicMan';

interface MusicmanPanelProps {
  roomId: string;
  hubId:  string;
  hasMusicman: boolean;
  onBotJoined: () => void;
}

// Minimal waveform animation - 5 bars that pulse when active
function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-4">
      {[0.6, 1, 0.75, 0.9, 0.5].map((height, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-emerald-400 transition-all"
          style={{
            height: active ? `${height * 100}%` : '20%',
            opacity: active ? 1 : 0.3,
            animation: active
              ? `musicbar ${0.8 + i * 0.15}s ease-in-out nfinite alternate`
              : 'none',
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes musicbar {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.0); }
        }
      `}</style>
    </div>
  );
}

export default function MusicmanPanel({ roomId, hubId, hasMusicman, onBotJoined }: MusicmanPanelProps) {
  const { join, leave, isActive, nowPlaying, loading, error, joinHub } = useMusicMan();

  const [expanded, setExpanded]   = useState(false);
  const [urlInput, setUrlInput]   = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active     = isActive(roomId);
  const playing    = nowPlaying(roomId);

  // Auto-focus input when expanded
  useEffect(() => {
    if (expanded && !active) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [expanded, active]);

  const isYoutubeUrl = (url: string) =>
    /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(url.trim());

  const handlePlay = async () => {
    setInputError(null);
    const url = urlInput.trim();
    if (!url) { setInputError('Paste a YouTube URL'); return; }
    if (!isYoutubeUrl(url)) { setInputError('Must be a YouTube URL'); return; }

    try {
      await join(roomId, url);
      setUrlInput('');
      setExpanded(false);
    } catch {
      // error surfaced via hook's error state
    }
  };

  const handleStop = async () => {
    try {
      await leave(roomId);
    } catch {
      // error surfaced via hook's error state
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePlay();
    if (e.key === 'Escape') setExpanded(false);
  };

  return (
    <div
      className={`
        rounded-lg border transition-all duration-200 overflow-hidden
        ${active
          ? 'border-emerald-500/40 bg-emerald-950/20'
          : 'border-border bg-muted/30'
        }
      `}
    >
      {/* ── Header row ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2">

        {/* Icon + waveform */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Music2
            className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-emerald-400' : 'text-muted-foreground'}`}
          />

          {active ? (
            <div className="flex items-center gap-2 min-w-0">
              <Waveform active={true} />
              <span className="text-xs text-emerald-400 truncate max-w-[140px]" title={playing ?? ''}>
                {playing
                  ? extractVideoTitle(playing)
                  : 'Playing…'
                }
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Music Bot</span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {active ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/30"
              onClick={handleStop}
              disabled={loading}
              title="Stop music bot"
            >
              {loading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Square className="h-3 w-3 fill-current" />
              }
            </Button>
          ) : hasMusicman ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(e => !e)}
              title={expanded ? 'Cancel' : 'Play music'}
            >
              {expanded
                ? <ChevronUp className="h-3 w-3" />
                : <Play className="h-3 w-3" />
              }
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-foreground px-2"
              onClick={async () => {
                  console.log('Joining Musicman hub...');
                  await joinHub(hubId);
                  onBotJoined();
              }}
              disabled={loading}
              title="Add bot to server"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '+ Add bot'}
            </Button>
          )}
        </div>
      </div>

      {/* ── Expanded URL input (only when not active) ───────────────── */}
      {expanded && !active && (
        <div className="px-3 pb-3 flex flex-col gap-2 border-t border-border/50 pt-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Youtube className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setInputError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="https://youtube.com/watch?v=…"
                className="h-8 text-xs pl-7 bg-background/50"
              />
            </div>
            <Button
              size="sm"
              className="h-8 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
              onClick={handlePlay}
              disabled={loading}
            >
              {loading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : 'Play'
              }
            </Button>
          </div>

          {/* Validation / API error */}
          {(inputError || error) && (
            <p className="text-xs text-red-400">{inputError ?? error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Pull the video ID out of a YouTube URL and return a short label.
// Falls back to the raw URL if parsing fails.
function extractVideoTitle(url: string): string {
  try {
    const u  = new URL(url);
    const id = u.searchParams.get('v') ?? u.pathname.split('/').pop();
    return id ? `youtube.com/…${id.slice(-6)}` : url;
  } catch {
    return url;
  }
}