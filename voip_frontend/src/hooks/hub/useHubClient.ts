import { useCallback } from 'react';
import { useAuth } from "@/hooks/auth/useAuth";

import config from '@/config/config';
import type { ChannelType, PostKeyBundlesPayload } from '@/types/hub.types';

export type HubClient = ReturnType<typeof useHubClient>;

export default function useHubClient() {
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

    const listHubs = useCallback(() => fetchAPI('/hubs'), [fetchAPI]);
    const getHub = useCallback((id: string) => fetchAPI(`/hubs/${id}`), [fetchAPI]);
    const createHub = useCallback((name: string) =>
        fetchAPI('/hubs', { method: 'POST', body: JSON.stringify({ name }) }), [fetchAPI]);
    const deleteHub = useCallback((id: string) =>
        fetchAPI(`/hubs/${id}`, { method: 'DELETE' }), [fetchAPI]);

    const listChannels = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/channels`), [fetchAPI]);
    const createChannel = useCallback((hubId: string, name: string, type: ChannelType = 'text') =>
        fetchAPI(`/hubs/${hubId}/channels`, { method: 'POST', body: JSON.stringify({ name, type }) }), [fetchAPI]);
    const deleteChannel = useCallback((hubId: string, channelId: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}`, { method: 'DELETE' }), [fetchAPI]);

    const listMembers = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/members`), [fetchAPI]);
    const inviteMember = useCallback((hubId: string, userId: string) =>
        fetchAPI(`/hubs/${hubId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }), [fetchAPI]);
    const leaveHub = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/leave`, { method: 'DELETE' }), [fetchAPI]);
    const kickMember = useCallback((hubId: string, memberId: string) =>
        fetchAPI(`/hubs/${hubId}/members/${memberId}`, { method: 'DELETE' }), [fetchAPI]);

    const sendMessage = useCallback((hubId: string, channelId: string, message: {
        ciphertext: string; iv: string; keyVersion: string;
    }) => fetchAPI(`/hubs/${hubId}/channels/${channelId}/messages`, {
        method: 'POST', body: JSON.stringify(message),
    }), [fetchAPI]);

    const createInvite = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/invites`, { method: 'POST' }), [fetchAPI]);

    const redeemInvite = useCallback((code: string) =>
        fetchAPI(`/invites/${code}/redeem`, { method: 'POST' }), [fetchAPI]);

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

    const registerDeviceKey = useCallback((hubId: string, deviceId: string, publicKey: string) =>
        fetchAPI(`/hubs/${hubId}/device-key`, {
            method: 'PUT',
            body: JSON.stringify({ deviceId, publicKey }),
        }), [fetchAPI]);

    const getDeviceKeys = useCallback((hubId: string) =>
        fetchAPI(`/hubs/${hubId}/device-keys`), [fetchAPI]);

    const postKeyBundles = useCallback((hubId: string, payload: PostKeyBundlesPayload) =>
        fetchAPI(`/hubs/${hubId}/channel-keys/bundles`, {
            method: 'POST',
            body: JSON.stringify(payload),
        }), [fetchAPI]);

    const getKeyBundles = useCallback((hubId: string, channelId?: string) => {
        const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
        return fetchAPI(`/hubs/${hubId}/channel-keys/bundles${query}`);
    }, [fetchAPI]);

    const setRotationNeeded = useCallback((hubId: string, channelId: string, removedUserId?: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}/rotation-needed`, {
            method: 'POST',
            body: JSON.stringify({ removedUserId: removedUserId ?? '' }),
        }), [fetchAPI]);

    const getRotationNeeded = useCallback((hubId: string, channelId: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}/rotation-needed`), [fetchAPI]);

    const clearRotationNeeded = useCallback((hubId: string, channelId: string) =>
        fetchAPI(`/hubs/${hubId}/channels/${channelId}/rotation-needed`, {
            method: 'DELETE',
        }), [fetchAPI]);

    return {
        listHubs, getHub, createHub, deleteHub,
        listChannels, createChannel, deleteChannel,
        listMembers, inviteMember, leaveHub, kickMember,
        sendMessage, getMessages,
        startEphemeral, getEphemeral, endEphemeral,
        createInvite, redeemInvite,
        registerDeviceKey, getDeviceKeys,
        postKeyBundles, getKeyBundles,
        setRotationNeeded, getRotationNeeded, clearRotationNeeded,
    };
}