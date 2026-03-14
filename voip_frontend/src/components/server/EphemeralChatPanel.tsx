import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LogOut, MessageSquare, Send } from 'lucide-react';
import type { EphemeralMessage } from '@/types/server.types';

interface EphemeralChatPanelProps {
    /** Whether the current user has joined the ephemeral room */
    joined: boolean;
    /** Whether the slide-in panel is expanded */
    open: boolean;
    messages: EphemeralMessage[];
    input: string;
    /** Formatted countdown string, e.g. "4:32" or "" */
    timeLeft: string;
    onToggle: () => void;
    onLeave: () => void;
    onSend: () => void;
    onInputChange: (value: string) => void;
}

export default function EphemeralChatPanel({
    joined,
    open,
    messages,
    input,
    timeLeft,
    onToggle,
    onLeave,
    onSend,
    onInputChange,
}: EphemeralChatPanelProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom whenever new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    if (!joined) return null;

    return (
        <div className={`absolute right-0 top-0 bottom-0 border-l bg-background flex flex-col shadow-xl z-10 transition-all duration-300 ${
            open ? 'w-80' : 'w-0'
        }`}>
            {/* Fold/unfold toggle on the left edge */}
            <button
                onClick={onToggle}
                className="absolute -left-6 top-1/2 -translate-y-1/2 h-12 w-6 bg-amber-600 hover:bg-amber-700 rounded-l-md flex items-center justify-center transition-colors z-20"
            >
                <svg
                    className={`h-4 w-4 text-white transition-transform duration-300 ${open ? 'rotate-0' : 'rotate-180'}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
            </button>

            {open && (
                <>
                    {/* Header */}
                    <div className="p-4 border-b flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-amber-400" />
                            <span className="font-medium text-sm">Ephemeral Chat</span>
                            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        </div>
                        <div className="group relative">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={onLeave}
                            >
                                <LogOut className="h-4 w-4" />
                            </Button>
                            <span className="absolute right-0 top-full mt-1 px-2 py-1 bg-popover border rounded text-[11px] text-popover-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                                Leave
                            </span>
                        </div>
                    </div>

                    {/* Encrypted notice + countdown */}
                    <div className="px-4 py-2 bg-amber-500/10 border-b flex items-center justify-between">
                        <p className="text-[11px] text-amber-400/80">
                            Messages Encrypted. Disappears when you leave.
                        </p>
                        {timeLeft && (
                            <span className="text-[11px] font-mono text-amber-400/80">
                                {timeLeft}
                            </span>
                        )}
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {messages.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-muted-foreground text-xs italic">
                                    No messages yet
                                </p>
                            </div>
                        ) : (
                            <>
                                {messages.map((msg, index) => {
                                    const isMine = msg.sender === 'me';
                                    return (
                                        <div key={index} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`px-3 py-2 rounded-2xl max-w-[80%] ${
                                                isMine
                                                    ? 'bg-amber-600 text-white'
                                                    : 'bg-muted text-foreground border'
                                            }`}>
                                                {!isMine && (
                                                    <p className="font-semibold text-[10px] mb-0.5 opacity-70">
                                                        {msg.alias || 'Anonymous'}
                                                    </p>
                                                )}
                                                <p className="text-sm">{msg.message}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </>
                        )}
                    </div>

                    {/* Input */}
                    <div className="p-3 border-t flex gap-2">
                        <Input
                            placeholder="Ephemeral message..."
                            value={input}
                            onChange={(e) => onInputChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && onSend()}
                            className="flex-1 text-sm"
                        />
                        <Button
                            onClick={onSend}
                            size="icon"
                            className="rounded-full h-9 w-9 bg-amber-600 hover:bg-amber-700"
                            disabled={!input.trim()}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
