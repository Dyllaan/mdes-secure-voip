import { useCallback } from 'react';
import { hubApi } from '@/axios/api';
import type { ChannelType, PostKeyBundlesPayload, Hub, Channel, Member, MessageHistoryResponse, ChannelKeyBundle, MemberDeviceKey } from '@/types/hub.types';

export type HubApi = ReturnType<typeof useHubApi>;

export default function useHubApi() {
    const listHubs = useCallback(() =>
        hubApi.get<Hub[]>('/hubs').then(r => r.data), []);

    const getHub = useCallback((id: string) =>
        hubApi.get<Hub>(`/hubs/${id}`).then(r => r.data), []);

    const createHub = useCallback((name: string) =>
        hubApi.post<Hub>('/hubs', { name }).then(r => r.data), []);

    const deleteHub = useCallback((id: string) =>
        hubApi.delete(`/hubs/${id}`).then(r => r.data ?? null), []);

    const listChannels = useCallback((hubId: string) =>
        hubApi.get<Channel[]>(`/hubs/${hubId}/channels`).then(r => r.data), []);

    const createChannel = useCallback((hubId: string, name: string, type: ChannelType = 'text') =>
        hubApi.post<Channel>(`/hubs/${hubId}/channels`, { name, type }).then(r => r.data), []);

    const deleteChannel = useCallback((hubId: string, channelId: string) =>
        hubApi.delete(`/hubs/${hubId}/channels/${channelId}`).then(r => r.data ?? null), []);

    const listMembers = useCallback((hubId: string) =>
        hubApi.get<Member[]>(`/hubs/${hubId}/members`).then(r => r.data), []);

    const inviteMember = useCallback((hubId: string, userId: string) =>
        hubApi.post(`/hubs/${hubId}/members`, { userId }).then(r => r.data ?? null), []);

    const leaveHub = useCallback((hubId: string) =>
        hubApi.delete(`/hubs/${hubId}/leave`).then(r => r.data ?? null), []);

    const kickMember = useCallback((hubId: string, memberId: string) =>
        hubApi.delete(`/hubs/${hubId}/members/${memberId}`).then(r => r.data ?? null), []);

    const sendMessage = useCallback((hubId: string, channelId: string, message: {
        ciphertext: string; iv: string; keyVersion: string;
    }) => hubApi.post(`/hubs/${hubId}/channels/${channelId}/messages`, message).then(r => r.data ?? null), []);

    const createInvite = useCallback((hubId: string) =>
        hubApi.post(`/hubs/${hubId}/invites`).then(r => r.data ?? null), []);

    const redeemInvite = useCallback((code: string) =>
        hubApi.post(`/invites/${code}/redeem`).then(r => r.data ?? null), []);

    const startEphemeral = useCallback((hubId: string, roomId: string) =>
        hubApi.post(`/hubs/${hubId}/ephemeral`, { roomId }).then(r => r.data ?? null), []);

    const getEphemeral = useCallback((hubId: string) =>
        hubApi.get(`/hubs/${hubId}/ephemeral`).then(r => r.data ?? null), []);

    const endEphemeral = useCallback((hubId: string) =>
        hubApi.delete(`/hubs/${hubId}/ephemeral`).then(r => r.data ?? null), []);

    const getMessages = useCallback((hubId: string, channelId: string, before?: string, limit?: number) => {
        const params: Record<string, string> = {};
        if (before) params.before = before;
        if (limit) params.limit = limit.toString();
        return hubApi.get<MessageHistoryResponse>(`/hubs/${hubId}/channels/${channelId}/messages`, { params }).then(r => r.data);
    }, []);

    const registerDeviceKey = useCallback((hubId: string, deviceId: string, publicKey: string) =>
        hubApi.put(`/hubs/${hubId}/device-key`, { deviceId, publicKey }).then(r => r.data ?? null), []);

    const getDeviceKeys = useCallback((hubId: string) =>
    hubApi.get<MemberDeviceKey[]>(`/hubs/${hubId}/device-keys`).then(r => r.data), []);

    const getKeyBundles = useCallback((hubId: string, channelId?: string) => {
        const params: Record<string, string> = {};
        if (channelId) params.channelId = channelId;
        return hubApi.get<ChannelKeyBundle[]>(`/hubs/${hubId}/channel-keys/bundles`, { params }).then(r => r.data);
    }, []);
    
    const postKeyBundles = useCallback((hubId: string, payload: PostKeyBundlesPayload) =>
        hubApi.post(`/hubs/${hubId}/channel-keys/bundles`, payload).then(r => r.data ?? null), []);

    const setRotationNeeded = useCallback((hubId: string, channelId: string, removedUserId?: string) =>
        hubApi.post(`/hubs/${hubId}/channels/${channelId}/rotation-needed`, {
            removedUserId: removedUserId ?? '',
        }).then(r => r.data ?? null), []);

    const getRotationNeeded = useCallback((hubId: string, channelId: string) =>
        hubApi.get(`/hubs/${hubId}/channels/${channelId}/rotation-needed`).then(r => r.data ?? null), []);

    const clearRotationNeeded = useCallback((hubId: string, channelId: string) =>
        hubApi.delete(`/hubs/${hubId}/channels/${channelId}/rotation-needed`).then(r => r.data ?? null), []);

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