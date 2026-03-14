import { useEffect, useState, useCallback } from 'react';
import { useServerAPI } from '@/hooks/useServer';
import { useAuth } from '@/hooks/useAuth';
import type { Server, Channel, Member } from '@/types/server.types';

interface UseServerDataReturn {
    server: Server | null;
    channels: Channel[];
    members: Member[];
    loading: boolean;
    /** Error from initial load only */
    error: string | null;
    /** true when the current user is the server owner */
    isOwner: boolean;
    /** Re-fetch the channel list — call after creating or deleting a channel */
    refreshChannels: () => Promise<void>;
}

/**
 * Loads a server's metadata, channel list, and member list.
 * Re-runs whenever `serverId` changes.
 */
export function useServerData(serverId: string | undefined): UseServerDataReturn {
    const { user } = useAuth();
    const { getServer, listChannels, listMembers } = useServerAPI();

    const [server, setServer] = useState<Server | null>(null);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!serverId) return;

        let cancelled = false;

        const load = async () => {
            try {
                setLoading(true);
                const [serverData, channelData, memberData] = await Promise.all([
                    getServer(serverId),
                    listChannels(serverId),
                    listMembers(serverId),
                ]);
                if (cancelled) return;
                setServer(serverData);
                setChannels(channelData);
                setMembers(memberData);
                setError(null);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load server');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [serverId, getServer, listChannels, listMembers]);

    const refreshChannels = useCallback(async () => {
        if (!serverId) return;
        const updated = await listChannels(serverId);
        setChannels(updated);
    }, [serverId, listChannels]);

    const isOwner = server != null && server.ownerId === user?.sub;

    return { server, channels, members, loading, error, isOwner, refreshChannels };
}
