import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EncryptedMessage } from '@/types/hub.types';

interface MessageBubbleProps {
    msg: EncryptedMessage;
    isMine: boolean;
    plaintext: string | null | undefined;
}

export default function MessageBubble({ msg, isMine, plaintext }: MessageBubbleProps) {
    const decryptionPending = plaintext === undefined;
    const decryptionFailed  = !decryptionPending && plaintext === null;

    return (
        <div className="flex justify-start">
            <div className={cn(
                'px-3.5 py-2 rounded-xl w-full transition-opacity',
                isMine
                    ? 'bg-muted/40'
                    : 'bg-muted/80 border border-border/40',
                decryptionFailed && 'opacity-50',
            )}>
                <div className="flex flex-row items-baseline justify-between gap-2 mb-0.5">
                    <p className={cn(
                        'text-[11px] font-medium tracking-wide',
                        isMine ? 'text-foreground/40' : 'text-foreground/60',
                    )}>
                        {isMine ? 'You' : `${msg.senderId.slice(0, 8)}…`}
                    </p>
                    <p className="text-[10px] text-foreground/30 tabular-nums">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>

                {decryptionFailed ? (
                    <span className="flex items-center gap-1.5 text-xs italic text-foreground/40">
                        <Lock className="h-3 w-3 shrink-0" />
                        Encrypted with unavailable key
                        <span className="font-mono text-[10px]">(v{msg.keyVersion})</span>
                    </span>
                ) : decryptionPending ? (
                    <span className="text-xs italic text-foreground/30">Decrypting…</span>
                ) : (
                    <p className="text-sm leading-snug">{plaintext}</p>
                )}
            </div>
        </div>
    );
}