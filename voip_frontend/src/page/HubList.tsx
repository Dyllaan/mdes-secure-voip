import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useHubAPI from '@/hooks/hub/useHubAPI';
import { useConnection } from '@/components/providers/ConnectionProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Server, ArrowRight, Phone } from 'lucide-react';
import type { Hub } from '@/types/hub.types';

export default function HubList() {
    const navigate = useNavigate();
    const hubAPI = useHubAPI();
    const { listHubs, createHub, redeemInvite } = hubAPI;
    const { socket, channelKeyManager } = useConnection();

    const [inviteInput, setInviteInput] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [hubs, setHubs] = useState<Hub[]>([]);
    const [newHubName, setNewHubName] = useState('');
    const [creating, setCreating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchHubs = async () => {
        try {
            setLoading(true);
            const data = await listHubs();
            setHubs(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load hubs');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHubs();
    }, [listHubs]);

    const handleCreate = async () => {
        if (!newHubName.trim()) return;
        try {
            setCreating(true);
            await createHub(newHubName.trim());
            setNewHubName('');
            await fetchHubs();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create hub');
        } finally {
            setCreating(false);
        }
    };

    const handleRedeem = async () => {
        if (!inviteInput.trim()) return;
        try {
            setRedeeming(true);
            const data = await redeemInvite(inviteInput.trim());
            setInviteInput('');
            await fetchHubs();

            // Register our device key with the new hub so existing members can
            // distribute channel keys to us
            if (channelKeyManager && data.hub?.id) {
                channelKeyManager.registerWithHub(hubAPI, data.hub.id)
                    .catch(err => console.warn('[HubList] Failed to register device key with new hub:', err));
            }

            // Notify existing hub members that a new member joined
            if (data.hub?.id) {
                socket?.emit('member-joined', { hubId: data.hub.id });
            }

            navigate(`/hubs/${data.hub.id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Invalid invite code');
        } finally {
            setRedeeming(false);
        }
    };

    return (
        <div className="h-screen flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-md space-y-6">
                <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold">Your Hubs</h1>
                    <p className="text-sm text-muted-foreground">
                        Select a hub or create a new one
                    </p>
                </div>

                {/* Create hub */}
                <div className="flex gap-2">
                    <Input
                        placeholder="Hub name..."
                        value={newHubName}
                        onChange={(e) => setNewHubName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    />
                    <Button onClick={handleCreate} disabled={creating || !newHubName.trim()}>
                        <Plus className="h-4 w-4 mr-2" />
                        {creating ? 'Creating...' : 'Create'}
                    </Button>
                </div>

                {/* Redeem invite */}
                <div className="flex gap-2">
                    <Input
                        placeholder="Invite code..."
                        value={inviteInput}
                        onChange={(e) => setInviteInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
                    />
                    <Button
                        variant="outline"
                        onClick={handleRedeem}
                        disabled={redeeming || !inviteInput.trim()}
                    >
                        {redeeming ? 'Joining...' : 'Join'}
                    </Button>
                </div>

                {error && (
                    <p className="text-sm text-destructive text-center">{error}</p>
                )}

                {/* Hub list */}
                <div className="space-y-2">
                    {loading ? (
                        <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
                    ) : hubs.length === 0 ? (
                        <div className="text-center py-8 space-y-2">
                            <Server className="h-8 w-8 mx-auto text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground">No hubs yet. Create one to get started.</p>
                        </div>
                    ) : (
                        hubs.map((hub) => (
                            <button
                                key={hub.id}
                                onClick={() => navigate(`/hubs/${hub.id}`)}
                                className="w-full flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <Server className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{hub.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Created {new Date(hub.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            </button>
                        ))
                    )}
                </div>

                {/* Link to ephemeral calls */}
                <div className="pt-4 border-t">
                    <button
                        onClick={() => navigate('/call')}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                        <Phone className="h-4 w-4" />
                        Join an ephemeral call instead
                    </button>
                </div>
            </div>
        </div>
    );
}