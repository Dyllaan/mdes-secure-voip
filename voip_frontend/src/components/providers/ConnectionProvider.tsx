import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import config from '@/config/config';
import { useAuth } from "@/hooks/auth/useAuth";
import { RoomClient } from '@/utils/crypto/RoomClient';
import { CryptKeyManager } from '@/utils/crypto/CryptKeyManager';
import useHubApi from '@/hooks/hub/useHubApi';
import type { HubApi } from '@/hooks/hub/useHubApi';
import { getAppE2EHarness } from '@/testing/e2eHarness';

interface ConnectionContextType {
    socket: Socket | null;
    roomClient: RoomClient | null;
    channelKeyManager: CryptKeyManager | null;
    hubApi: HubApi;
    isConnected: boolean;
    assignedPeerId: string | null;
}

const ConnectionContext = createContext<ConnectionContextType>({
    socket: null,
    roomClient: null,
    channelKeyManager: null,
    hubApi: {} as HubApi,
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

    const hubApi = useHubApi();

    const [socket, setSocket] = useState<Socket | null>(null);
    const [roomClient, setRoomClient] = useState<RoomClient | null>(null);
    const [channelKeyManager, setChannelKeyManager] = useState<CryptKeyManager | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [assignedPeerId, setAssignedPeerId] = useState<string | null>(null);

    const socketRef = useRef<Socket | null>(null);
    const roomClientRef = useRef<RoomClient | null>(null);
    const channelKeyManagerRef = useRef<CryptKeyManager | null>(null);
    const accessTokenRef = useRef(accessToken);
    const hubApiRef = useRef(hubApi);

    useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
    useEffect(() => { hubApiRef.current = hubApi; }, [hubApi]);

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
        getAppE2EHarness()?.registerSocket(voipSocket as never);

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
            try {
                const client = new RoomClient(voipSocket);
                roomClientRef.current = client;
                await client.initialize();
                if (!cancelled) setRoomClient(client);
            } catch (error) {
                console.error('Failed to initialize RoomClient:', error);
            }

            try {
                const client = hubApiRef.current;
                const hubs: Array<{ id: string }> = await client.listHubs();
                const hubIds = hubs.map((h) => h.id);
                const manager = await CryptKeyManager.create(user?.sub ?? username ?? '',client, hubIds);
                channelKeyManagerRef.current = manager;

                if (!cancelled) {
                    setChannelKeyManager(manager);
                    for (const sid of hubIds) {
                        manager.syncKeyBundles(sid, undefined, client).catch((err) =>
                            console.warn(`[CryptKeyManager] Background bundle sync failed for hub ${sid}:`, err)
                        );
                    }
                }
            } catch (error) {
                console.error('Failed to initialize CryptKeyManager:', error);
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
            roomClientRef.current?.cleanup();
            voipSocket.disconnect();
            socketRef.current = null;
            roomClientRef.current = null;
            channelKeyManagerRef.current = null;
            setSocket(null);
            setRoomClient(null);
            setChannelKeyManager(null);
            setIsConnected(false);
            setAssignedPeerId(null);
        };
    }, [signedIn, accessToken, username]);

    return (
        <ConnectionContext.Provider value={{ socket, roomClient, channelKeyManager, hubApi, isConnected, assignedPeerId }}>
            {children}
        </ConnectionContext.Provider>
    );
}
