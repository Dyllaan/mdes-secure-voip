import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EncryptedMessage } from '@/types/hub.types';

interface MessageBubbleProps {
  msg: EncryptedMessage;
  isMine: boolean;
  plaintext: string | null | undefined;
  showHeader?: boolean;
}

export default function MessageBubble({
  msg,
  isMine,
  plaintext,
  showHeader = true,
}: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const decryptionPending = plaintext === undefined;
  const decryptionFailed = !decryptionPending && plaintext === null;
  const messageText = plaintext ?? '';

  const shouldClamp = useMemo(() => {
    if (decryptionPending || decryptionFailed) return false;
    return messageText.length > 280 || messageText.split('\n').length > 6;
  }, [decryptionPending, decryptionFailed, messageText]);

  const senderLabel = isMine ? 'You' : `${msg.senderId.slice(0, 8)}…`;

  const timestampLabel = useMemo(() => {
    const date = new Date(msg.timestamp);
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [msg.timestamp]);

  return (
    <div
      className={cn(
        'group flex w-full justify-start rounded-lg px-2 py-1 transition-colors hover:bg-accent/30',
        !showHeader && 'pt-0.5'
      )}
    >
      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="mb-1 flex min-w-0 items-baseline justify-between gap-3">
            <p
              className={cn(
                'truncate text-[12px] font-semibold tracking-wide',
                isMine ? 'text-foreground/55' : 'text-foreground/70'
              )}
            >
              {senderLabel}
            </p>

            <p className="shrink-0 text-[10px] text-foreground/35 tabular-nums transition-colours group-hover:text-foreground/55">
              {timestampLabel}
            </p>
          </div>
        )}

        {decryptionFailed ? (
          <div
            className={cn(
              'rounded-xl border px-3 py-2',
              isMine
                ? 'border-border/30 bg-muted/30'
                : 'border-border/40 bg-muted/60'
            )}
          >
            <div className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/45" />
              <div className="min-w-0">
                <p className="text-xs italic text-foreground/55">
                  Encrypted with unavailable key
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-foreground/35">
                  key version: v{msg.keyVersion}
                </p>
              </div>
            </div>
          </div>
        ) : decryptionPending ? (
          <div
            className={cn(
              'rounded-xl px-3 py-2',
              isMine ? 'bg-muted/20' : 'bg-muted/40'
            )}
          >
            <span className="text-xs italic text-foreground/40">
              Decrypting…
            </span>
          </div>
        ) : (
          <div
            className={cn(
              'rounded-xl px-3 py-2',
              isMine
                ? 'bg-muted/25'
                : 'border border-border/35 bg-muted/65',
              !showHeader && 'ml-0'
            )}
          >
            <p
              className={cn(
                'text-sm leading-6 text-foreground/95',
                'whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
                !expanded && shouldClamp && 'line-clamp-2'
              )}
            >
              {messageText}
            </p>

            {shouldClamp && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}