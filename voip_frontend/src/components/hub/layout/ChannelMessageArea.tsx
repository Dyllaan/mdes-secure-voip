import { Button } from '@/components/ui/button';
import { Hash, Send } from 'lucide-react';
import MessageBubble from '@/components/hub/MessageBubble';
import { useHubLayout } from '@/contexts/HubLayoutContext';
import { useChannelMessages } from '@/hooks/hub/useChannelMessages';
import { useChannelEncryption } from '@/hooks/hub/useChannelEncryption';
import { useMemo, useState } from 'react';
import Validator from '@/utils/validation/Validator';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/auth/useAuth';
import { cn } from '@/lib/utils';

export default function ChannelMessageArea() {
  const { user } = useAuth();
  const { hub, channels, channelId } = useHubLayout();

  const channelName = channelId
    ? channels.find((c) => c.id === channelId)?.name ?? 'Unknown channel'
    : undefined;

  const {
    messages,
    hasMore,
    loadOlderMessages,
    sendMessage,
    refreshMessages,
  } = useChannelMessages(hub?.id, channelId);

  const { decryptedMessages } = useChannelEncryption(
    hub?.id,
    channelId,
    messages,
    refreshMessages
  );

  const [messageInput, setMessageInput] = useState('');
  const validation = useMemo(() => new Validator(), []);
  const messageValid = validation.validate('Message', messageInput).valid;

  const handleSend = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed) return;
    await sendMessage(trimmed);
    setMessageInput('');
  };

  const shouldShowHeader = (index: number) => {
    const current = messages[index];
    const previous = messages[index - 1];

    if (!previous) return true;
    if (previous.senderId !== current.senderId) return true;

    const prevTime = new Date(previous.timestamp).getTime();
    const currentTime = new Date(current.timestamp).getTime();

    return currentTime - prevTime > 5 * 60 * 1000;
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      {channelName !== undefined ? (
        <>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{channelName}</span>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-3 md:px-4">
            {hasMore && (
              <button
                className="mx-auto mb-3 block text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={loadOlderMessages}
              >
                Load older messages
              </button>
            )}

            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm italic text-muted-foreground">
                  No messages yet. Start the conversation!
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {messages.map((msg, index) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isMine={msg.senderId === user?.sub}
                    plaintext={
                      msg.id in decryptedMessages
                        ? decryptedMessages[msg.id]
                        : undefined
                    }
                    showHeader={shouldShowHeader(index)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t p-4">
            <div className="flex items-end gap-3 rounded-2xl border bg-card p-3 shadow-sm">
              <Textarea
                data-testid="channel-message-input"
                placeholder="Message #channel"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                className={cn(
                  'max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0',
                  !messageValid && messageInput.length > 0 && 'text-destructive'
                )}
              />

              <Button
                data-testid="channel-message-send"
                onClick={handleSend}
                size="icon"
                className="shrink-0 rounded-full"
                disabled={!messageValid || !messageInput.trim()}
              >
                <Send className="h-5 w-5" />
              </Button>
            </div>

            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Enter to send, Shift+Enter for a new line
            </p>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-2 text-center">
            <Hash className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="text-muted-foreground">Select a channel to start chatting</p>
          </div>
        </div>
      )}
    </div>
  );
}
