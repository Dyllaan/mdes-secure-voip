import { Button } from '@/components/ui/button';
import { Hash, Send } from 'lucide-react';
import MessageBubble from '@/components/hub/MessageBubble';
import { useHubLayout } from '@/contexts/HubLayoutContext';
import { useChannelMessages } from '@/hooks/hub/useChannelMessages';
import { useChannelEncryption } from '@/hooks/hub/useChannelEncryption';
import { useState } from 'react';
import Validator from '@/utils/validation/Validator';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/auth/useAuth';

export default function ChannelMessageArea() {

    const { user } = useAuth();
    const {
        hub, channels, channelId
    } = useHubLayout();

    
    const channelName = channelId
        ? (channels.find(c => c.id === channelId)?.name ?? 'Unknown channel')
        : undefined;

    const { messages, hasMore, loadOlderMessages, sendMessage, refreshMessages } = useChannelMessages(hub?.id, channelId);
    const { decryptedMessages } = useChannelEncryption(hub?.id, channelId, messages, refreshMessages);
    
    const [messageInput, setMessageInput] = useState('');
    const [messageValid, setMessageValid] = useState(false);
    const validation = new Validator();


    const handleInputChange = (value: string) => {
        setMessageInput(value);
        setMessageValid(validation.validate("Message", value).valid);
    };

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
                                onClick={loadOlderMessages}
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
                                    isMine={msg.senderId === user?.sub}
                                    plaintext={msg.id in decryptedMessages ? decryptedMessages[msg.id] : undefined}
                                />
                            ))
                        )}
                        </div>
                        )}
                    </div>

                    <div className="p-4 border-t flex gap-3">
                        <Textarea
                            placeholder="Type a message..."
                            value={messageInput}
                            onChange={(e) => handleInputChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && sendMessage(messageInput)}
                            className={`flex-1 border border-${messageValid ? 'primary' : 'destructive'} focus:ring-${messageValid ? 'primary' : 'destructive'}`}
                        />
                        <Button
                            onClick={() => sendMessage(messageInput)}
                            size="icon"
                            className="rounded-full"
                            disabled={!messageValid}
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
