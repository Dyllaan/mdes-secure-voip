import { useEffect, useRef, useState } from 'react';
import useHubAPI from '@/hooks/hub/useHubAPI';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/components/providers/ConnectionProvider';
import type { EncryptedMessage } from '@/types/hub.types';

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
    hubId: string | undefined,
    channelId: string | undefined,
): UseChannelMessagesReturn {
    const { user } = useAuth();
    const { socket, channelKeyManager } = useConnection();
    const hubAPI = useHubAPI();
    const { getMessages, sendMessage: apiSendMessage } = hubAPI;

    // Stable ref so async callbacks always read the latest hubAPI tokens
    const hubAPIRef = useRef(hubAPI);
    useEffect(() => { hubAPIRef.current = hubAPI; }, [hubAPI]);

    const [messages, setMessages]                     = useState<EncryptedMessage[]>([]);
    const [hasMore, setHasMore]                       = useState(false);
    const [decryptedMessages, setDecryptedMessages]   = useState<Record<string, string | null>>({});

    // ------------------------------------------------------------------
    // Load messages when channel changes
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!hubId || !channelId) {
            setMessages([]);
            return;
        }

        const load = async () => {
            try {
                const data = await getMessages(hubId, channelId);
                setMessages(data.messages || []);
                setHasMore(data.hasMore || false);
            } catch (err) {
                console.error('[useChannelMessages] Failed to load messages:', err);
            }
        };

        load();
    }, [hubId, channelId, getMessages]);

    // ------------------------------------------------------------------
    // Sync channel key bundles when channel changes
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!hubId || !channelId || !channelKeyManager) return;
        channelKeyManager
            .syncKeyBundles(hubId, channelId, hubAPIRef.current)
            .catch(err => console.warn('[useChannelMessages] Key bundle sync failed:', err));
    }, [hubId, channelId, channelKeyManager]);

    // ------------------------------------------------------------------
    // Decrypt all messages whenever the list changes
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!messages.length || !channelKeyManager || !hubId) return;

        let cancelled = false;

        const decryptAll = async () => {
            const results: Record<string, string | null> = {};
            await Promise.all(
                messages.map(async (msg) => {
                    const plaintext = await channelKeyManager.decrypt(
                        msg.channelId,
                        msg.senderId,
                        { ciphertext: msg.ciphertext, iv: msg.iv, keyVersion: msg.keyVersion },
                        hubId,
                        hubAPIRef.current,
                    );
                    results[msg.id] = plaintext;
                })
            );
            if (!cancelled) setDecryptedMessages(results);
        };

        decryptAll();
        return () => { cancelled = true; };
    }, [messages, channelKeyManager, hubId]);

    // ------------------------------------------------------------------
    // Real-time: new message broadcast
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // Real-time: key rotation broadcast
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!socket || !hubId || !channelKeyManager) return;

        const onKeyRotated = async (data: { hubId: string; channelId: string }) => {
            if (data.hubId !== hubId) return;

            await channelKeyManager
                .syncKeyBundles(data.hubId, data.channelId, hubAPIRef.current)
                .catch(err => console.warn('[useChannelMessages] Key bundle sync on rotation failed:', err));

            if (data.channelId === channelId) {
                try {
                    const result = await getMessages(hubId, data.channelId);
                    setMessages(result.messages || []);
                } catch (err) {
                    console.error('[useChannelMessages] Failed to reload messages after key rotation:', err);
                }
            }
        };

        socket.on('channel-key-rotated', onKeyRotated);
        return () => { socket.off('channel-key-rotated', onKeyRotated); };
    }, [socket, hubId, channelId, channelKeyManager, getMessages]);

    // ------------------------------------------------------------------
    // Load older messages (pagination)
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // Send a message (encrypt → API → socket notify → refresh)
    // ------------------------------------------------------------------
    const sendMessage = async (text: string) => {
        if (!hubId || !channelId) return;

        if (!channelKeyManager || !user?.sub) {
            throw new Error('Encryption not ready - channelKeyManager or user identity unavailable');
        }

        const payload = await channelKeyManager.encrypt(
            channelId,
            hubId,
            user.sub,
            text,
            hubAPIRef.current,
            (event) => {
                socket?.emit('channel-key-rotated', event);
            },
        );

        await apiSendMessage(hubId, channelId, payload);

        // Refresh own messages immediately
        const data = await getMessages(hubId, channelId);
        setMessages(data.messages || []);
        setHasMore(data.hasMore || false);

        // Notify peers via socket
        if (socket) {
            socket.emit('channel-message-sent', { hubId, channelId });
        }
    };

    return { messages, hasMore, decryptedMessages, loadOlderMessages, sendMessage };
}
