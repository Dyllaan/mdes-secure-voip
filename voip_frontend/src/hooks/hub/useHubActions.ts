import { useCallback } from 'react';
import { useConnection } from '@/components/providers/ConnectionProvider';
import type { ChannelType } from '@/types/hub.types';

export default function useHubActions(hubId: string | undefined) {
    const { hubClient } = useConnection();

    const kickMember = useCallback(async (memberId: string) => {
        if (!hubId) return;
        await hubClient.kickMember(hubId, memberId);
    }, [hubId, hubClient]);

    const createChannel = useCallback(async (name: string, type: ChannelType = 'text') => {
        if (!hubId) return null;
        return hubClient.createChannel(hubId, name, type);
    }, [hubId, hubClient]);

    const deleteChannel = useCallback(async (channelId: string) => {
        if (!hubId) return;
        await hubClient.deleteChannel(hubId, channelId);
    }, [hubId, hubClient]);

    const createInvite = useCallback(async () => {
        if (!hubId) return null;
        return hubClient.createInvite(hubId);
    }, [hubId, hubClient]);

    const inviteMember = useCallback(async (userId: string) => {
        if (!hubId) return;
        await hubClient.inviteMember(hubId, userId);
    }, [hubId, hubClient]);

    const deleteHub = useCallback(async () => {
        if (!hubId) return;
        await hubClient.deleteHub(hubId);
    }, [hubId, hubClient]);

    return { kickMember, createChannel, deleteChannel, createInvite, inviteMember, deleteHub };
}