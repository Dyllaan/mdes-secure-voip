import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/components/providers/ConnectionProvider';
import type { EncryptedMessage } from '@/types/hub.types';

interface UseChannelMessagesReturn {
    messages: EncryptedMessage[];
    hasMore: boolean;
    refreshMessages: () => Promise<void>;
    loadOlderMessages: () => Promise<void>;
    sendMessage: (text: string) => Promise<void>;
}

export function useChannelMessages(
    hubId: string | undefined,
    channelId: string | undefined,
): UseChannelMessagesReturn {
    const { user } = useAuth();
    const { socket, channelKeyManager, hubClient } = useConnection();
    const { getMessages, sendMessage: apiSendMessage } = hubClient;

    const [messages, setMessages] = useState<EncryptedMessage[]>([]);
    const [hasMore, setHasMore] = useState(false);

    useEffect(() => {
        if (!hubId || !channelId) {
            setMessages([]);
            return;
        }

        getMessages(hubId, channelId)
            .then(data => {
                setMessages(data.messages || []);
                setHasMore(data.hasMore || false);
            })
            .catch(err => console.error('[useChannelMessages] Failed to load messages:', err));
    }, [hubId, channelId, getMessages]);

    const refreshMessages = useCallback(async () => {
        if (!hubId || !channelId) return;
        try {
            const data = await getMessages(hubId, channelId);
            setMessages(data.messages || []);
            setHasMore(data.hasMore || false);
        } catch (err) {
            console.error('[useChannelMessages] Failed to refresh messages:', err);
        }
    }, [hubId, channelId, getMessages]);

    useEffect(() => {
        if (!socket || !hubId) return;

        const onNewMessage = async (data: { hubId: string; channelId: string }) => {
            if (data.hubId !== hubId || data.channelId !== channelId) return;
            try {
                const result = await getMessages(hubId, data.channelId);
                setMessages(result.messages || []);
                setHasMore(result.hasMore || false);
            } catch (err) {
                console.error('[useChannelMessages] Failed to fetch new messages:', err);
            }
        };

        socket.on('channel-message-sent', onNewMessage);
        return () => { socket.off('channel-message-sent', onNewMessage); };
    }, [socket, hubId, channelId, getMessages]);

    const loadOlderMessages = async () => {
        if (!hubId || !channelId || messages.length === 0) return;
        const oldest = messages[0].timestamp;
        try {
            const data = await getMessages(hubId, channelId, oldest);
            setMessages(prev => [...(data.messages || []), ...prev]);
            setHasMore(data.hasMore || false);
        } catch (err) {
            console.error('[useChannelMessages] Failed to load older messages:', err);
        }
    };

    const sendMessage = async (text: string) => {
        if (!hubId || !channelId) return;
        if (!channelKeyManager || !user?.sub) {
            throw new Error('Encryption not ready');
        }

        const payload = await channelKeyManager.encrypt(
            channelId,
            hubId,
            user.sub,
            text,
            hubClient,
            (event) => { socket?.emit('channel-key-rotated', event); },
        );

        await apiSendMessage(hubId, channelId, payload);

        const data = await getMessages(hubId, channelId);
        setMessages(data.messages || []);
        setHasMore(data.hasMore || false);

        socket?.emit('channel-message-sent', { hubId, channelId });
    };

    return { messages, hasMore, refreshMessages, loadOlderMessages, sendMessage };
}