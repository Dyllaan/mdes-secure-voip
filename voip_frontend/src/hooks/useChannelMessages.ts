import { useEffect, useRef, useState } from 'react';
import { useServerAPI } from '@/hooks/useServer';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/components/providers/ConnectionProvider';
import type { EncryptedMessage } from '@/types/server.types';

interface UseChannelMessagesReturn {
    messages: EncryptedMessage[];
    hasMore: boolean;
    /** message id → decrypted plaintext (null = decryption failed) */
    decryptedMessages: Record<string, string | null>;
    /** Load messages older than the earliest current message */
    loadOlderMessages: () => Promise<void>;
    /** Encrypt and send a message to the active channel */
    sendMessage: (text: string) => Promise<void>;
}

/**
 * Manages the message list for a single channel:
 * initial load, pagination, real-time socket updates, key-bundle sync,
 * decryption, and send (with encryption).
 */
export function useChannelMessages(
    serverId: string | undefined,
    channelId: string | undefined,
): UseChannelMessagesReturn {
    const { user } = useAuth();
    const { socket, channelKeyManager } = useConnection();
    const serverAPI = useServerAPI();
    const { getMessages, sendMessage: apiSendMessage } = serverAPI;

    // Stable ref so async callbacks always read the latest serverAPI tokens
    const serverAPIRef = useRef(serverAPI);
    useEffect(() => { serverAPIRef.current = serverAPI; }, [serverAPI]);

    const [messages, setMessages]                     = useState<EncryptedMessage[]>([]);
    const [hasMore, setHasMore]                       = useState(false);
    const [decryptedMessages, setDecryptedMessages]   = useState<Record<string, string | null>>({});

    // ------------------------------------------------------------------
    // Load messages when channel changes
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!serverId || !channelId) {
            setMessages([]);
            return;
        }

        const load = async () => {
            try {
                const data = await getMessages(serverId, channelId);
                setMessages(data.messages || []);
                setHasMore(data.hasMore || false);
            } catch (err) {
                console.error('[useChannelMessages] Failed to load messages:', err);
            }
        };

        load();
    }, [serverId, channelId, getMessages]);

    // ------------------------------------------------------------------
    // Sync channel key bundles when channel changes
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!serverId || !channelId || !channelKeyManager) return;
        channelKeyManager
            .syncKeyBundles(serverId, channelId, serverAPIRef.current)
            .catch(err => console.warn('[useChannelMessages] Key bundle sync failed:', err));
    }, [serverId, channelId, channelKeyManager]);

    // ------------------------------------------------------------------
    // Decrypt all messages whenever the list changes
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!messages.length || !channelKeyManager || !serverId) return;

        let cancelled = false;

        const decryptAll = async () => {
            const results: Record<string, string | null> = {};
            await Promise.all(
                messages.map(async (msg) => {
                    const plaintext = await channelKeyManager.decrypt(
                        msg.channelId,
                        msg.senderId,
                        { ciphertext: msg.ciphertext, iv: msg.iv, keyVersion: msg.keyVersion },
                        serverId,
                        serverAPIRef.current,
                    );
                    results[msg.id] = plaintext;
                })
            );
            if (!cancelled) setDecryptedMessages(results);
        };

        decryptAll();
        return () => { cancelled = true; };
    }, [messages, channelKeyManager, serverId]);

    // ------------------------------------------------------------------
    // Real-time: new message broadcast
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!socket || !serverId) return;

        const onNewMessage = async (data: { serverId: string; channelId: string }) => {
            if (data.serverId !== serverId || data.channelId !== channelId) return;
            try {
                const result = await getMessages(serverId, data.channelId);
                setMessages(result.messages || []);
                setHasMore(result.hasMore || false);
            } catch (err) {
                console.error('[useChannelMessages] Failed to fetch new messages:', err);
            }
        };

        socket.on('channel-message-sent', onNewMessage);
        return () => { socket.off('channel-message-sent', onNewMessage); };
    }, [socket, serverId, channelId, getMessages]);

    // ------------------------------------------------------------------
    // Real-time: key rotation broadcast
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!socket || !serverId || !channelKeyManager) return;

        const onKeyRotated = async (data: { serverId: string; channelId: string }) => {
            if (data.serverId !== serverId) return;

            await channelKeyManager
                .syncKeyBundles(data.serverId, data.channelId, serverAPIRef.current)
                .catch(err => console.warn('[useChannelMessages] Key bundle sync on rotation failed:', err));

            if (data.channelId === channelId) {
                try {
                    const result = await getMessages(serverId, data.channelId);
                    setMessages(result.messages || []);
                } catch (err) {
                    console.error('[useChannelMessages] Failed to reload messages after key rotation:', err);
                }
            }
        };

        socket.on('channel-key-rotated', onKeyRotated);
        return () => { socket.off('channel-key-rotated', onKeyRotated); };
    }, [socket, serverId, channelId, channelKeyManager, getMessages]);

    // ------------------------------------------------------------------
    // Load older messages (pagination)
    // ------------------------------------------------------------------
    const loadOlderMessages = async () => {
        if (!serverId || !channelId || messages.length === 0) return;
        const oldest = messages[0].timestamp;
        try {
            const data = await getMessages(serverId, channelId, oldest);
            setMessages(prev => [...(data.messages || []), ...prev]);
            setHasMore(data.hasMore || false);
        } catch (err) {
            console.error('[useChannelMessages] Failed to load older messages:', err);
        }
    };

    // ------------------------------------------------------------------
    // Send a message (encrypt → API → socket notify → refresh)
    // ------------------------------------------------------------------
    const sendMessage = async (text: string) => {
        if (!serverId || !channelId) return;

        if (!channelKeyManager || !user?.sub) {
            throw new Error('Encryption not ready — channelKeyManager or user identity unavailable');
        }

        const payload = await channelKeyManager.encrypt(
            channelId,
            serverId,
            user.sub,
            text,
            serverAPIRef.current,
        );

        await apiSendMessage(serverId, channelId, payload);

        // Refresh own messages immediately
        const data = await getMessages(serverId, channelId);
        setMessages(data.messages || []);
        setHasMore(data.hasMore || false);

        // Notify peers via socket
        if (socket) {
            socket.emit('channel-message-sent', { serverId, channelId });
        }
    };

    return { messages, hasMore, decryptedMessages, loadOlderMessages, sendMessage };
}
