import { useEffect, useState, useCallback } from 'react';
import { useAuth } from "@/hooks/auth/useAuth";

import { useConnection } from '@/components/providers/ConnectionProvider';
import type { Hub, Channel, Member } from '@/types/hub.types';
import useHubApi from './useHubApi';
import { toast } from 'sonner';

interface UseHubStateReturn {
    hub: Hub | null;
    channels: Channel[];
    members: Member[];
    loading: boolean;
    error: string | null;
    isOwner: boolean;
    hasMusicman: boolean;
    refreshChannels: () => Promise<void>;
    refreshMembers: () => Promise<void>;
}

/**
 * Performs only GET operations related to hub state (hub info, channels, members) and listens for relevant socket events to keep data up-to-date.
 * Does not include any action functions (create channel, kick member, etc) - those are handled separately in useHubActions to keep this hook focused on state management.
 * This separation allows components to use hub state without being forced to also include action logic, and helps avoid unnecessary re-renders when actions are performed.
 */

export default function useHubState(hubId: string | undefined): UseHubStateReturn {
    const { user } = useAuth();
    const { socket, channelKeyManager } = useConnection();
    const hubApi = useHubApi();
    const { getHub, listChannels, listMembers } = hubApi;

    const [hub, setHub] = useState<Hub | null>(null);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!hubId) return;
        let cancelled = false;

        const load = async () => {
            try {
                setLoading(true);
                const [hubData, channelData, memberData] = await Promise.all([
                    getHub(hubId),
                    listChannels(hubId),
                    listMembers(hubId),
                ]);
                if (cancelled) return;
                setHub(hubData);
                setChannels(channelData);
                setMembers(memberData);
                setError(null);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load hub');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [hubId, getHub, listChannels, listMembers]);

    const refreshChannels = useCallback(async () => {
        if (!hubId) return;
        const updated = await listChannels(hubId);
        setChannels(updated);
    }, [hubId, listChannels]);

    const refreshMembers = useCallback(async () => {
        if (!hubId) return;
        const updated = await listMembers(hubId);
        setMembers(updated);
    }, [hubId, listMembers]);

    useEffect(() => {
        if (!socket || !hubId) return;
        socket.emit('hub:join', hubId);
        return () => { socket.emit('hub:leave', hubId); };
    }, [socket, hubId]);

    useEffect(() => {
        if (!socket || !hubId) return;

        const onChannelChanged = (data: { hubId: string }) => {
            if (data.hubId !== hubId) return;
            listChannels(hubId)
                .then(setChannels)
                .catch(err => console.warn('Failed to refresh channels:', err));
        };

        socket.on('channel-created', onChannelChanged);
        socket.on('channel-deleted', onChannelChanged);
        return () => {
            socket.off('channel-created', onChannelChanged);
            socket.off('channel-deleted', onChannelChanged);
        };
    }, [socket, hubId, listChannels]);

    useEffect(() => {
        if (!socket || !hubId) return;

        const onMemberJoined = (data: { hubId: string }) => {
            if (data.hubId !== hubId) return;
            listMembers(hubId)
                .then(setMembers)
                .catch(() => toast.error('Failed to refresh members after join event:'));

            if (channelKeyManager) {
                for (const ch of channels) {
                    channelKeyManager.topUpChannelKey(ch.id, hubId, hubApi, (event) => {
                        socket?.emit('channel-key-rotated', event);
                    }).catch(err =>
                        console.warn('Key top-up failed for channel', ch.id, ':', err)
                    );
                }
            }
        };

        socket.on('member-joined', onMemberJoined);
        return () => { socket.off('member-joined', onMemberJoined); };
    }, [socket, hubId, listMembers, channels, channelKeyManager, hubApi]);

    const isOwner = !!hub && !!user?.sub && hub.ownerId === user.sub;
    const hasMusicman = members.some(m => m.role === 'bot');

    return { hub, channels, members, loading, error, isOwner, hasMusicman, refreshChannels, refreshMembers };
}