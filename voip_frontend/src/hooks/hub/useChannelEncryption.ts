import { useEffect, useState } from 'react';
import { useConnection } from '@/components/providers/ConnectionProvider';
import type { EncryptedMessage } from '@/types/hub.types';
import useHubApi from './useHubApi';

interface UseChannelEncryptionReturn {
    decryptedMessages: Record<string, string | null>;
}

export function useChannelEncryption(
    hubId: string | undefined,
    channelId: string | undefined,
    messages: EncryptedMessage[],
    onKeyRotated?: () => Promise<void>,
): UseChannelEncryptionReturn {
    const { socket, channelKeyManager } = useConnection();
    const hubApi = useHubApi();
    
    const [decryptedMessages, setDecryptedMessages] = useState<Record<string, string | null>>({});

    useEffect(() => {
        if (!hubId || !channelId || !channelKeyManager) return;
        channelKeyManager
            .syncKeyBundles(hubId, channelId, hubApi)
            .catch(err => console.warn('[useChannelEncryption] Key bundle sync failed:', err));
    }, [hubId, channelId, channelKeyManager, hubApi]);

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
                        hubApi,
                    );
                    results[msg.id] = plaintext;
                })
            );
            if (!cancelled) setDecryptedMessages(results);
        };

        decryptAll();
        return () => { cancelled = true; };
    }, [messages, channelKeyManager, hubId, hubApi]);

    useEffect(() => {
        if (!socket || !hubId || !channelKeyManager) return;

        const handleKeyRotated = async (data: { hubId: string; channelId: string }) => {
            if (data.hubId !== hubId) return;
            await channelKeyManager
                .syncKeyBundles(data.hubId, data.channelId, hubApi)
                .catch(err => console.warn('[useChannelEncryption] Key bundle sync on rotation failed:', err));

            if (data.channelId === channelId) {
                await onKeyRotated?.();
            }
        };

        socket.on('channel-key-rotated', handleKeyRotated);
        return () => { socket.off('channel-key-rotated', handleKeyRotated); };
    }, [socket, hubId, channelId, channelKeyManager, hubApi, onKeyRotated]);

    return { decryptedMessages };
}