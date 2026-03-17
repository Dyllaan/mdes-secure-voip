import { useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import config from '@/config/config';
import type { ChannelType, PostKeyBundlesPayload } from '@/types/hub.types';

export default function useHubAPI() {
    const { user } = useAuth();

    const fetchAPI = useCallback(async (path: string, options: RequestInit = {}) => {
        const res = await fetch(`${config.HUB_SERVICE_URL}${path}`, {
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

    // Hubs
    const listHubs = useCallback(() => fetchAPI('/hubs'), [fetchAPI]);
    const getHub = useCallback((id: string) => fetchAPI(`/hubs/${id}`), [fetchAPI]);
    const createHub = useCallback((name: string) =>
        fetchAPI('/hubs', { method: 'POST', body: JSON.stringify({ name }) }), [fetchAPI]);
    const deleteHub = useCallback((id: string) =>
        fetchAPI(`/hubs/${id}`, { method: 'DELETE' }), [fetchAPI]);

    // Channels
    const listChannels = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/channels`), [fetchAPI]);
    const createChannel = useCallback((hubId: string, name: string, type: ChannelType = 'text') =>
        fetchAPI(`/hubs/${hubId}/channels`, { method: 'POST', body: JSON.stringify({ name, type }) }), [fetchAPI]);
    const deleteChannel = useCallback((hubId: string, channelId: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}`, { method: 'DELETE' }), [fetchAPI]);

    // Members
    const listMembers = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/members`), [fetchAPI]);
    const inviteMember = useCallback((hubId: string, userId: string) =>
        fetchAPI(`/hubs/${hubId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }), [fetchAPI]);
    const leaveHub = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/leave`, { method: 'DELETE' }), [fetchAPI]);
    const kickMember = useCallback((hubId: string, memberId: string) =>
        fetchAPI(`/hubs/${hubId}/members/${memberId}`, { method: 'DELETE' }), [fetchAPI]);

    // Messages
    const sendMessage = useCallback((hubId: string, channelId: string, message: {
        ciphertext: string; iv: string; keyVersion: string;
    }) => fetchAPI(`/hubs/${hubId}/channels/${channelId}/messages`, {
        method: 'POST', body: JSON.stringify(message),
    }), [fetchAPI]);

    // Invites
    const createInvite = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/invites`, { method: 'POST' }), [fetchAPI]);

    const redeemInvite = useCallback((code: string) =>
        fetchAPI(`/invites/${code}/redeem`, { method: 'POST' }), [fetchAPI]);

    // Ephemeral chat
    const startEphemeral = useCallback((hubId: string, roomId: string) =>
        fetchAPI(`/hubs/${hubId}/ephemeral`, { method: 'POST', body: JSON.stringify({ roomId }) }), [fetchAPI]);

    const getEphemeral = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/ephemeral`), [fetchAPI]);

    const endEphemeral = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/ephemeral`, { method: 'DELETE' }), [fetchAPI]);

    const getMessages = useCallback((hubId: string, channelId: string, before?: string, limit?: number) => {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        if (limit) params.set('limit', limit.toString());
        const query = params.toString() ? `?${params.toString()}` : '';
        return fetchAPI(`/hubs/${hubId}/channels/${channelId}/messages${query}`);
    }, [fetchAPI]);

    // --- Channel encryption: device keys ---

    /** Register or update the caller's P-256 ECDH public key for a hub. */
    const registerDeviceKey = useCallback((hubId: string, deviceId: string, publicKey: string) =>
        fetchAPI(`/hubs/${hubId}/device-key`, {
            method: 'PUT',
            body: JSON.stringify({ deviceId, publicKey }),
        }), [fetchAPI]);

    /** Fetch all P-256 ECDH public keys for all devices of all members in a server. */
    const getDeviceKeys = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/device-keys`), [fetchAPI]);

    // --- Channel encryption: key bundles ---

    /** Store ECIES-encrypted channel key bundles for a key epoch. */
    const postKeyBundles = useCallback((hubId: string, payload: PostKeyBundlesPayload) =>
        fetchAPI(`/hubs/${hubId}/channel-keys/bundles`, {
            method: 'POST',
            body: JSON.stringify(payload),
        }), [fetchAPI]);

    /** Fetch ECIES key bundles addressed to the calling user's device(s), optionally filtered by channel. */
    const getKeyBundles = useCallback((hubId: string, channelId?: string) => {
        const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
        return fetchAPI(`/hubs/${hubId}/channel-keys/bundles${query}`);
    }, [fetchAPI]);

    // --- Channel encryption: rotation flags ---

    /** Flag a channel as needing key rotation (call when removing a member). */
    const setRotationNeeded = useCallback((hubId: string, channelId: string, removedUserId?: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}/rotation-needed`, {
            method: 'POST',
            body: JSON.stringify({ removedUserId: removedUserId ?? '' }),
        }), [fetchAPI]);

    /** Get the rotation flag for a channel. */
    const getRotationNeeded = useCallback((hubId: string, channelId: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}/rotation-needed`), [fetchAPI]);

    /** Clear the rotation flag after a successful key rotation. */
    const clearRotationNeeded = useCallback((hubId: string, channelId: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}/rotation-needed`, {
            method: 'DELETE',
        }), [fetchAPI]);

    return {
        listHubs, getHub, createHub, deleteHub,
        listChannels, createChannel, deleteChannel,
        listMembers, inviteMember, leaveHub,
        sendMessage, getMessages,
        startEphemeral, getEphemeral, endEphemeral,
        createInvite, redeemInvite,
        // encryption
        registerDeviceKey, getDeviceKeys,
        postKeyBundles, getKeyBundles,
        setRotationNeeded, getRotationNeeded, clearRotationNeeded,
        kickMember,
    };
}