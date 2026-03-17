import { useEffect, useState, useCallback } from 'react';
import useHubAPI from '@/hooks/hub/useHubAPI';
import { useAuth } from '@/hooks/auth/useAuth';
import type { Hub, Channel, Member } from '@/types/hub.types';

interface UseHubDataReturn {
    hub: Hub | null;
    channels: Channel[];
    members: Member[];
    loading: boolean;
    error: string | null;
    isOwner: boolean;
    hasMusicman: boolean;
    refreshChannels: () => Promise<void>;
    refreshMembers: () => Promise<void>;
    kickMember: (memberId: string) => Promise<void>;
}

export default function useHubData(hubId: string | undefined): UseHubDataReturn {
    const { user } = useAuth();
    const { getHub, listChannels, listMembers, kickMember } = useHubAPI();

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
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load hub');
                }
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

    const isOwner = hub != null && hub.ownerId === user?.sub;
    const hasMusicman = members.some(m => m.role === 'bot');

    const handleKickMember = useCallback(async (memberId: string) => {
        if (!hubId) return;
        if (!isOwner) {
            setError('Only the hub owner can kick members');
            return;
        }
        await kickMember(hubId, memberId);
        setMembers(members.filter(m => m.id !== memberId));
    }, [hubId, isOwner, kickMember]);


    return { hub, channels, members, loading, error, isOwner, hasMusicman, refreshChannels, refreshMembers, kickMember: handleKickMember };
}