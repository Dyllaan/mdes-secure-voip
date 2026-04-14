import { useCallback } from 'react';
import { hubApi } from '@/axios/api';

import type { ChannelType, PostKeyBundlesPayload } from '@/types/hub.types';

export type HubClient = ReturnType<typeof useHubClient>;

export default function useHubClient() {
    const request = useCallback(async (path: string, options: {
        method?: string;
        data?: unknown;
        params?: Record<string, string>;
    } = {}) => {
        const res = await hubApi.request({
            url: path,
            method: options.method ?? 'GET',
            data: options.data,
            params: options.params,
        });
        return res.data ?? null;
    }, []);

    const listHubs = useCallback(() => request('/hubs'), [request]);
    const getHub = useCallback((id: string) => request(`/hubs/${id}`), [request]);
    const createHub = useCallback((name: string) =>
        request('/hubs', { method: 'POST', data: { name } }), [request]);
    const deleteHub = useCallback((id: string) =>
        request(`/hubs/${id}`, { method: 'DELETE' }), [request]);

    const listChannels = useCallback((hubId: string) =>
        request(`/hubs/${hubId}/channels`), [request]);
    const createChannel = useCallback((hubId: string, name: string, type: ChannelType = 'text') =>
        request(`/hubs/${hubId}/channels`, { method: 'POST', data: { name, type } }), [request]);
    const deleteChannel = useCallback((hubId: string, channelId: string) =>
        request(`/hubs/${hubId}/channels/${channelId}`, { method: 'DELETE' }), [request]);

    const listMembers = useCallback((hubId: string) =>
        request(`/hubs/${hubId}/members`), [request]);
    const inviteMember = useCallback((hubId: string, userId: string) =>
        request(`/hubs/${hubId}/members`, { method: 'POST', data: { userId } }), [request]);
    const leaveHub = useCallback((hubId: string) =>
        request(`/hubs/${hubId}/leave`, { method: 'DELETE' }), [request]);
    const kickMember = useCallback((hubId: string, memberId: string) =>
        request(`/hubs/${hubId}/members/${memberId}`, { method: 'DELETE' }), [request]);

    const sendMessage = useCallback((hubId: string, channelId: string, message: {
        ciphertext: string; iv: string; keyVersion: string;
    }) => request(`/hubs/${hubId}/channels/${channelId}/messages`, {
        method: 'POST', data: message,
    }), [request]);

    const createInvite = useCallback((hubId: string) =>
        request(`/hubs/${hubId}/invites`, { method: 'POST' }), [request]);

    const redeemInvite = useCallback((code: string) =>
        request(`/invites/${code}/redeem`, { method: 'POST' }), [request]);

    const startEphemeral = useCallback((hubId: string, roomId: string) =>
        request(`/hubs/${hubId}/ephemeral`, { method: 'POST', data: { roomId } }), [request]);

    const getEphemeral = useCallback((hubId: string) =>
        request(`/hubs/${hubId}/ephemeral`), [request]);

    const endEphemeral = useCallback((hubId: string) =>
        request(`/hubs/${hubId}/ephemeral`, { method: 'DELETE' }), [request]);

    const getMessages = useCallback((hubId: string, channelId: string, before?: string, limit?: number) => {
        const params: Record<string, string> = {};
        if (before) params.before = before;
        if (limit) params.limit = limit.toString();
        return request(`/hubs/${hubId}/channels/${channelId}/messages`, { params });
    }, [request]);

    const registerDeviceKey = useCallback((hubId: string, deviceId: string, publicKey: string) =>
        request(`/hubs/${hubId}/device-key`, {
            method: 'PUT',
            data: { deviceId, publicKey },
        }), [request]);

    const getDeviceKeys = useCallback((hubId: string) =>
        request(`/hubs/${hubId}/device-keys`), [request]);

    const postKeyBundles = useCallback((hubId: string, payload: PostKeyBundlesPayload) =>
        request(`/hubs/${hubId}/channel-keys/bundles`, {
            method: 'POST',
            data: payload,
        }), [request]);

    const getKeyBundles = useCallback((hubId: string, channelId?: string) => {
        const params: Record<string, string> = {};
        if (channelId) params.channelId = channelId;
        return request(`/hubs/${hubId}/channel-keys/bundles`, { params });
    }, [request]);

    const setRotationNeeded = useCallback((hubId: string, channelId: string, removedUserId?: string) =>
        request(`/hubs/${hubId}/channels/${channelId}/rotation-needed`, {
            method: 'POST',
            data: { removedUserId: removedUserId ?? '' },
        }), [request]);

    const getRotationNeeded = useCallback((hubId: string, channelId: string) =>
        request(`/hubs/${hubId}/channels/${channelId}/rotation-needed`), [request]);

    const clearRotationNeeded = useCallback((hubId: string, channelId: string) =>
        request(`/hubs/${hubId}/channels/${channelId}/rotation-needed`, {
            method: 'DELETE',
        }), [request]);

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