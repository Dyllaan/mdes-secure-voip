import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Hash, Send, X } from 'lucide-react';
import MessageBubble from '@/components/hub/MessageBubble';
import { useHubLayout } from '@/contexts/HubLayoutContext';
import ScreenshareVideo from '../room/screenshare/ScreenshareVideo';
import { ScreenshareManager } from '../room/screenshare/ScreenshareManager';

export default function ChannelMessageArea() {

    const {
        channelName, messages, decryptedMessages, hasMore,
        messageInput, userId, onLoadOlder, onInputChange, onSend,
    } = useHubLayout();

    return (
        <div className="flex-1 flex flex-col min-w-0">
            {channelName !== undefined ? (
                <>
                    <div className="p-4 border-b flex items-center gap-2">
                        <Hash className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{channelName}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3">         
                    
                        {hasMore && (
                            <button
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto block"
                                onClick={onLoadOlder}
                            >
                                Load older messages
                            </button>
                        )}
                        {messages.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-muted-foreground text-sm italic">
                                    No messages yet. Start the conversation!
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4">
                            {(messages.map((msg) => (
                                <MessageBubble
                                    key={msg.id}
                                    msg={msg}
                                    isMine={msg.senderId === userId}
                                    plaintext={msg.id in decryptedMessages ? decryptedMessages[msg.id] : undefined}
                                />
                            ))
                        )}
                        </div>
                        )}
                    </div>

                    <div className="p-4 border-t flex gap-3">
                        <Input
                            placeholder="Type a message..."
                            value={messageInput}
                            onChange={(e) => onInputChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && onSend()}
                            className="flex-1"
                        />
                        <Button
                            onClick={onSend}
                            size="icon"
                            className="rounded-full"
                            disabled={!messageInput.trim()}
                        >
                            <Send className="h-5 w-5" />
                        </Button>
                    </div>
                </>
            ) : (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-2">
                        <Hash className="h-8 w-8 mx-auto text-muted-foreground/40" />
                        <p className="text-muted-foreground">Select a channel to start chatting</p>
                    </div>
                </div>
            )}
        </div>
    );
}
