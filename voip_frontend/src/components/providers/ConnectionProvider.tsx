import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import config from '@/config/config';
import { useAuth } from '@/hooks/useAuth';
import { SignalProtocolClient } from '@/utils/SignalProtocolClient';
import { RoomClient } from '@/utils/RoomClient';
import { CryptKeyManager } from '@/utils/CryptKeyManager';
import useHubAPI from '@/hooks/hub/useHubAPI';

interface ConnectionContextType {
    socket: Socket | null;
    signalClient: SignalProtocolClient | null;
    roomClient: RoomClient | null;
    channelKeyManager: CryptKeyManager | null;
    isConnected: boolean;
    assignedPeerId: string | null;
}

const ConnectionContext = createContext<ConnectionContextType>({
    socket: null,
    signalClient: null,
    roomClient: null,
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

    const hubAPI = useHubAPI();

    const [socket, setSocket] = useState<Socket | null>(null);
    const [signalClient, setSignalClient] = useState<SignalProtocolClient | null>(null);
    const [roomClient, setRoomClient] = useState<RoomClient | null>(null);
    const [channelKeyManager, setChannelKeyManager] = useState<CryptKeyManager | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [assignedPeerId, setAssignedPeerId] = useState<string | null>(null);

    const socketRef = useRef<Socket | null>(null);
    const signalClientRef = useRef<SignalProtocolClient | null>(null);
    const roomClientRef = useRef<RoomClient | null>(null);
    const channelKeyManagerRef = useRef<CryptKeyManager | null>(null);
    const accessTokenRef = useRef(accessToken);
    const hubAPIRef = useRef(hubAPI);

    useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
    useEffect(() => { hubAPIRef.current = hubAPI; }, [hubAPI]);

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

            // 1. Signal Protocol client — DMs only
            try {
                const client = new SignalProtocolClient(username, voipSocket);
                signalClientRef.current = client;
                await client.initialize('persistent');
                if (!cancelled) setSignalClient(client);
            } catch (error) {
                console.error('Failed to initialize Signal Protocol:', error);
            }

            // 2. Room client — AES group encryption for all rooms
            try {
                const client = new RoomClient(voipSocket);
                roomClientRef.current = client;
                await client.initialize();
                if (!cancelled) setRoomClient(client);
            } catch (error) {
                console.error('Failed to initialize RoomClient:', error);
            }

            // 3. CryptKeyManager — persistent channel encryption
            try {
                const api = hubAPIRef.current;
                const hubs: Array<{ id: string }> = await api.listHubs();
                const hubIds = hubs.map((h) => h.id);
                const manager = await CryptKeyManager.create(api, hubIds);
                channelKeyManagerRef.current = manager;

                if (!cancelled) {
                    setChannelKeyManager(manager);
                    for (const sid of hubIds) {
                        manager.syncKeyBundles(sid, undefined, api).catch((err) =>
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
            signalClientRef.current?.cleanup();
            roomClientRef.current?.cleanup();
            voipSocket.disconnect();
            socketRef.current = null;
            signalClientRef.current = null;
            roomClientRef.current = null;
            channelKeyManagerRef.current = null;
            setSocket(null);
            setSignalClient(null);
            setRoomClient(null);
            setChannelKeyManager(null);
            setIsConnected(false);
            setAssignedPeerId(null);
        };
    }, [signedIn, accessToken, username]);

    return (
        <ConnectionContext.Provider value={{ socket, signalClient, roomClient, channelKeyManager, isConnected, assignedPeerId }}>
            {children}
        </ConnectionContext.Provider>
    );
}