import { Lock } from 'lucide-react';
import type { EncryptedMessage } from '@/types/server.types';

interface MessageBubbleProps {
    msg: EncryptedMessage;
    isMine: boolean;
    /**
     * Decrypted plaintext.
     * - `undefined`  → decryption still in progress
     * - `null`       → decryption failed (key unavailable)
     * - `string`     → successfully decrypted text
     */
    plaintext: string | null | undefined;
}

export default function MessageBubble({ msg, isMine, plaintext }: MessageBubbleProps) {
    const decryptionPending = plaintext === undefined;
    const decryptionFailed  = !decryptionPending && plaintext === null;

    return (
        <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
            <div className={`px-4 py-2.5 rounded-2xl max-w-[75%] ${
                isMine
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground border'
            } ${decryptionFailed ? 'opacity-60' : ''}`}>
                {!isMine && (
                    <p className="font-semibold text-xs mb-1 opacity-70">
                        {msg.senderId.slice(0, 8)}...
                    </p>
                )}
                {decryptionFailed ? (
                    <span className="flex items-center gap-1.5 text-sm italic opacity-70">
                        <Lock className="h-3 w-3" />
                        Message encrypted with unavailable key (v{msg.keyVersion})
                    </span>
                ) : decryptionPending ? (
                    <span className="text-sm opacity-50 italic">Decrypting…</span>
                ) : (
                    <p className="text-sm">{plaintext}</p>
                )}
                <p className="text-[10px] opacity-50 mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
            </div>
        </div>
    );
}
