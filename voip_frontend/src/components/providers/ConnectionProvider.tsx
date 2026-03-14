import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import config from '@/config/config';
import { useAuth } from '@/hooks/useAuth';
import { SignalProtocolClient } from '@/utils/SignalProtocolClient';
import { CryptKeyManager } from '@/utils/CryptKeyManager';
import { useServerAPI } from '@/hooks/useServer';

interface ConnectionContextType {
    socket: Socket | null;
    signalClient: SignalProtocolClient | null;
    channelKeyManager: CryptKeyManager | null;
    isConnected: boolean;
    assignedPeerId: string | null;
}

const ConnectionContext = createContext<ConnectionContextType>({
    socket: null,
    signalClient: null,
    channelKeyManager: null,
    isConnected: false,
    assignedPeerId: null,
});

export function useConnection() {
    return useContext(ConnectionContext);
}

export default function ConnectionProvider({ children }: { children: React.ReactNode }) {
    const { user, signedIn } = useAuth();
    const username = user?.username ?? null;
    const accessToken = user?.accessToken ?? null;

    const serverAPI = useServerAPI();

    const [socket, setSocket] = useState<Socket | null>(null);
    const [signalClient, setSignalClient] = useState<SignalProtocolClient | null>(null);
    const [channelKeyManager, setChannelKeyManager] = useState<CryptKeyManager | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [assignedPeerId, setAssignedPeerId] = useState<string | null>(null);

    const socketRef = useRef<Socket | null>(null);
    const signalClientRef = useRef<SignalProtocolClient | null>(null);
    const channelKeyManagerRef = useRef<CryptKeyManager | null>(null);
    const accessTokenRef = useRef(accessToken);
    // Keep serverAPI ref so the connect handler can always access latest tokens
    const serverAPIRef = useRef(serverAPI);

    useEffect(() => {
        accessTokenRef.current = accessToken;
    }, [accessToken]);

    useEffect(() => {
        serverAPIRef.current = serverAPI;
    }, [serverAPI]);

    useEffect(() => {
        if (!signedIn || !accessToken || !username) return;

        let cancelled = false;

        const voipSocket = io(config.SIGNALING_SERVER, {
            path: '/socket.io/',
            auth: (cb) => cb({ token: accessTokenRef.current, username }),
            transports: ['websocket', 'polling'],
            withCredentials: true,
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
        });

        socketRef.current = voipSocket;
        setSocket(voipSocket);

        // Capture peer-assigned immediately — this fires right on connect
        // before any child components have mounted their listeners
        voipSocket.on('peer-assigned', ({ peerId }: { peerId: string }) => {
            if (!cancelled) {
                console.log('Peer ID assigned by server:', peerId);
                setAssignedPeerId(peerId);
            }
        });

        voipSocket.on('connect', async () => {
            if (cancelled) return;
            console.log('Socket.IO connected:', voipSocket.id);
            setIsConnected(true);

            if (!username) return;

            // 1. Initialize Signal Protocol client (ephemeral room encryption)
            try {
                const client = new SignalProtocolClient(username, voipSocket);
                signalClientRef.current = client;
                await client.initialize('persistent');
                if (!cancelled) setSignalClient(client);
            } catch (error) {
                console.error('Failed to initialize Signal Protocol encryption:', error);
            }

            // 2. Initialize CryptKeyManager (persistent channel encryption)
            try {
                const api = serverAPIRef.current;

                // Fetch all servers this user belongs to so we can register our device key
                const servers: Array<{ id: string }> = await api.listServers();
                const serverIds = servers.map((s) => s.id);

                const manager = await CryptKeyManager.create(api, serverIds);
                channelKeyManagerRef.current = manager;

                if (!cancelled) {
                    setChannelKeyManager(manager);

                    // Eagerly sync any key bundles that were distributed while we were offline
                    for (const sid of serverIds) {
                        manager.syncKeyBundles(sid, undefined, api).catch((err) =>
                            console.warn(
                                `[CryptKeyManager] Background bundle sync failed for server ${sid}:`,
                                err
                            )
                        );
                    }
                }
            } catch (error) {
                console.error('Failed to initialize channel key manager:', error);
            }
        });

        voipSocket.on('connect_error', (error) => {
            console.error('Socket.IO connection error:', error.message);
            if (!cancelled) setIsConnected(false);
        });

        voipSocket.on('disconnect', (reason) => {
            console.log('Socket.IO disconnected:', reason);
            if (!cancelled) setIsConnected(false);
        });

        return () => {
            cancelled = true;
            signalClientRef.current?.cleanup();
            voipSocket.disconnect();
            socketRef.current = null;
            signalClientRef.current = null;
            channelKeyManagerRef.current = null;
            setSocket(null);
            setSignalClient(null);
            setChannelKeyManager(null);
            setIsConnected(false);
            setAssignedPeerId(null);
        };
    }, [signedIn, accessToken, username]);

    return (
        <ConnectionContext.Provider value={{ socket, signalClient, channelKeyManager, isConnected, assignedPeerId }}>
            {children}
        </ConnectionContext.Provider>
    );
}
