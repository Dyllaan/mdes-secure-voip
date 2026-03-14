import { useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import config from '@/config/config';
import type { ChannelType, PostKeyBundlesPayload } from '@/types/server.types';

export function useServerAPI() {
    const { user } = useAuth();

    const fetchAPI = useCallback(async (path: string, options: RequestInit = {}) => {
        const res = await fetch(`${config.SERVER_API_URL}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user?.accessToken}`,
                ...options.headers,
            },
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'Request failed');
        }

        if (res.status === 204) return null;
        return res.json();
    }, [user?.accessToken]);

    // Servers
    const listServers = useCallback(() => fetchAPI('/servers'), [fetchAPI]);
    const getServer = useCallback((id: string) => fetchAPI(`/servers/${id}`), [fetchAPI]);
    const createServer = useCallback((name: string) =>
        fetchAPI('/servers', { method: 'POST', body: JSON.stringify({ name }) }), [fetchAPI]);
    const deleteServer = useCallback((id: string) =>
        fetchAPI(`/servers/${id}`, { method: 'DELETE' }), [fetchAPI]);

    // Channels
    const listChannels = useCallback((serverId: string) =>
        fetchAPI(`/servers/${serverId}/channels`), [fetchAPI]);
    const createChannel = useCallback((serverId: string, name: string, type: ChannelType = 'text') =>
        fetchAPI(`/servers/${serverId}/channels`, { method: 'POST', body: JSON.stringify({ name, type }) }), [fetchAPI]);
    const deleteChannel = useCallback((serverId: string, channelId: string) =>
        fetchAPI(`/servers/${serverId}/channels/${channelId}`, { method: 'DELETE' }), [fetchAPI]);

    // Members
    const listMembers = useCallback((serverId: string) =>
        fetchAPI(`/servers/${serverId}/members`), [fetchAPI]);
    const inviteMember = useCallback((serverId: string, userId: string) =>
        fetchAPI(`/servers/${serverId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }), [fetchAPI]);
    const leaveServer = useCallback((serverId: string) =>
        fetchAPI(`/servers/${serverId}/leave`, { method: 'DELETE' }), [fetchAPI]);

    // Messages
    const sendMessage = useCallback((serverId: string, channelId: string, message: {
        ciphertext: string; iv: string; keyVersion: string;
    }) => fetchAPI(`/servers/${serverId}/channels/${channelId}/messages`, {
        method: 'POST', body: JSON.stringify(message),
    }), [fetchAPI]);

    // Invites
    const createInvite = useCallback((serverId: string) =>
        fetchAPI(`/servers/${serverId}/invites`, { method: 'POST' }), [fetchAPI]);

    const redeemInvite = useCallback((code: string) =>
        fetchAPI(`/invites/${code}/redeem`, { method: 'POST' }), [fetchAPI]);

    // Ephemeral chat
    const startEphemeral = useCallback((serverId: string, roomId: string) =>
        fetchAPI(`/servers/${serverId}/ephemeral`, { method: 'POST', body: JSON.stringify({ roomId }) }), [fetchAPI]);

    const getEphemeral = useCallback((serverId: string) =>
        fetchAPI(`/servers/${serverId}/ephemeral`), [fetchAPI]);

    const endEphemeral = useCallback((serverId: string) =>
        fetchAPI(`/servers/${serverId}/ephemeral`, { method: 'DELETE' }), [fetchAPI]);

    const getMessages = useCallback((serverId: string, channelId: string, before?: string, limit?: number) => {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        if (limit) params.set('limit', limit.toString());
        const query = params.toString() ? `?${params.toString()}` : '';
        return fetchAPI(`/servers/${serverId}/channels/${channelId}/messages${query}`);
    }, [fetchAPI]);

    // --- Channel encryption: device keys ---

    /** Register or update the caller's P-256 ECDH public key for a server. */
    const registerDeviceKey = useCallback((serverId: string, deviceId: string, publicKey: string) =>
        fetchAPI(`/servers/${serverId}/device-key`, {
            method: 'PUT',
            body: JSON.stringify({ deviceId, publicKey }),
        }), [fetchAPI]);

    /** Fetch all P-256 ECDH public keys for all devices of all members in a server. */
    const getDeviceKeys = useCallback((serverId: string) =>
        fetchAPI(`/servers/${serverId}/device-keys`), [fetchAPI]);

    // --- Channel encryption: key bundles ---

    /** Store ECIES-encrypted channel key bundles for a key epoch. */
    const postKeyBundles = useCallback((serverId: string, payload: PostKeyBundlesPayload) =>
        fetchAPI(`/servers/${serverId}/channel-keys/bundles`, {
            method: 'POST',
            body: JSON.stringify(payload),
        }), [fetchAPI]);

    /** Fetch ECIES key bundles addressed to the calling user's device(s), optionally filtered by channel. */
    const getKeyBundles = useCallback((serverId: string, channelId?: string) => {
        const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
        return fetchAPI(`/servers/${serverId}/channel-keys/bundles${query}`);
    }, [fetchAPI]);

    // --- Channel encryption: rotation flags ---

    /** Flag a channel as needing key rotation (call when removing a member). */
    const setRotationNeeded = useCallback((serverId: string, channelId: string, removedUserId?: string) =>
        fetchAPI(`/servers/${serverId}/channels/${channelId}/rotation-needed`, {
            method: 'POST',
            body: JSON.stringify({ removedUserId: removedUserId ?? '' }),
        }), [fetchAPI]);

    /** Get the rotation flag for a channel. */
    const getRotationNeeded = useCallback((serverId: string, channelId: string) =>
        fetchAPI(`/servers/${serverId}/channels/${channelId}/rotation-needed`), [fetchAPI]);

    /** Clear the rotation flag after a successful key rotation. */
    const clearRotationNeeded = useCallback((serverId: string, channelId: string) =>
        fetchAPI(`/servers/${serverId}/channels/${channelId}/rotation-needed`, {
            method: 'DELETE',
        }), [fetchAPI]);

    return {
        listServers, getServer, createServer, deleteServer,
        listChannels, createChannel, deleteChannel,
        listMembers, inviteMember, leaveServer,
        sendMessage, getMessages,
        startEphemeral, getEphemeral, endEphemeral,
        createInvite, redeemInvite,
        // encryption
        registerDeviceKey, getDeviceKeys,
        postKeyBundles, getKeyBundles,
        setRotationNeeded, getRotationNeeded, clearRotationNeeded,
    };
}