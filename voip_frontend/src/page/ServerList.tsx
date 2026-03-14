import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServerAPI } from '@/hooks/useServer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Server, ArrowRight, Phone } from 'lucide-react';
import type { Server as ServerType } from '@/types/server.types';

export default function ServerList() {
    const navigate = useNavigate();
    const { listServers, createServer, redeemInvite } = useServerAPI();

    const [inviteInput, setInviteInput] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [servers, setServers] = useState<ServerType[]>([]);
    const [newServerName, setNewServerName] = useState('');
    const [creating, setCreating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchServers = async () => {
        try {
            setLoading(true);
            const data = await listServers();
            setServers(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load servers');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchServers();
    }, [listServers]);

    const handleCreate = async () => {
        if (!newServerName.trim()) return;
        try {
            setCreating(true);
            await createServer(newServerName.trim());
            setNewServerName('');
            await fetchServers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create server');
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
            await fetchServers();
            navigate(`/servers/${data.server.id}`);
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
                    <h1 className="text-2xl font-bold">Your Servers</h1>
                    <p className="text-sm text-muted-foreground">
                        Select a server or create a new one
                    </p>
                </div>

                {/* Create server */}
                <div className="flex gap-2">
                    <Input
                        placeholder="Server name..."
                        value={newServerName}
                        onChange={(e) => setNewServerName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    />
                    <Button onClick={handleCreate} disabled={creating || !newServerName.trim()}>
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

                {/* Server list */}
                <div className="space-y-2">
                    {loading ? (
                        <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
                    ) : servers.length === 0 ? (
                        <div className="text-center py-8 space-y-2">
                            <Server className="h-8 w-8 mx-auto text-muted-foreground/40" />
                            <p className="text-sm text-muted-foreground">No servers yet. Create one to get started.</p>
                        </div>
                    ) : (
                        servers.map((server) => (
                            <button
                                key={server.id}
                                onClick={() => navigate(`/servers/${server.id}`)}
                                className="w-full flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <Server className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{server.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Created {new Date(server.createdAt).toLocaleDateString()}
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