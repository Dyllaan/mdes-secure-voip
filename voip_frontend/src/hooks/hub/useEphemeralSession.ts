import { useEffect, useState } from 'react';
import { useAuth } from "@/hooks/auth/useAuth";

import { useConnection } from '@/components/providers/ConnectionProvider';
import type { EphemeralMessage } from '@/types/hub.types';

export interface EphemeralSession {
    active: boolean;
    joined: boolean;
    messages: EphemeralMessage[];
    timeLeft: string;
    start: () => Promise<void>;
    join: () => Promise<void>;
    leave: () => void;
    end: () => Promise<void>;
    send: (text: string) => Promise<void>;
}

export function useEphemeralSession(hubId: string | undefined): EphemeralSession {
    const { user } = useAuth();
    const { socket, roomClient, hubClient } = useConnection();
    const { startEphemeral, getEphemeral, endEphemeral } = hubClient;

    const [roomId, setRoomId]       = useState<string | null>(null);
    const [active, setActive]       = useState(false);
    const [joined, setJoined]       = useState(false);
    const [messages, setMessages]   = useState<EphemeralMessage[]>([]);
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [timeLeft, setTimeLeft]   = useState('');

    useEffect(() => {
        if (!hubId) return;

        const check = async () => {
            try {
                const data = await getEphemeral(hubId);
                setActive(data.active);
                if (data.active) {
                    setRoomId(data.roomId);
                    setExpiresAt(data.expiresAt);
                } else {
                    setRoomId(null);
                    setExpiresAt(null);
                    setJoined(prev => {
                        if (prev) setMessages([]);
                        return false;
                    });
                }
            } catch {
                // ignore transient poll errors
            }
        };

        check();
        const id = setInterval(check, 5000);
        return () => clearInterval(id);
    }, [hubId, getEphemeral]);

    useEffect(() => {
        if (!expiresAt) {
            setTimeLeft('');
            return;
        }

        const tick = () => {
            const remaining = expiresAt - Math.floor(Date.now() / 1000);
            if (remaining <= 0) { setTimeLeft('Expired'); return; }
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            setTimeLeft(`${m}:${s.toString().padStart(2, '0')}`);
        };

        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [expiresAt]);

    useEffect(() => {
        if (!roomClient || !joined) return;

        roomClient.onRoomMessageDecrypted = (msg) => {
            setMessages(prev => [...prev, {
                sender: msg.senderUserId,
                message: msg.message,
                alias: msg.senderAlias,
                timestamp: msg.timestamp,
            }]);
        };

        return () => { roomClient.onRoomMessageDecrypted = undefined; };
    }, [roomClient, joined]);

    const start = async () => {
        if (!hubId) return;
        try {
            const data = await startEphemeral(hubId, `ephemeral-${hubId}`);
            setRoomId(data.roomId);
            setActive(true);
        } catch (err) {
            console.error('[useEphemeralSession] Failed to start:', err);
        }
    };

    const join = async () => {
        if (!roomId || !socket || !roomClient) return;
        try {
            const existingUsers = await new Promise<string[]>((resolve) => {
                socket.once('all-users', (users: { peerId: string; alias: string; userId: string }[]) => {
                    resolve(users.filter(u => u.alias !== 'musicman').map(u => u.userId));
                });
                socket.emit('join-room', {
                    roomId,
                    alias: user?.username || 'Anonymous',
                    userId: user?.sub,
                });
            });

            await roomClient.joinRoom(roomId, existingUsers);
            setJoined(true);
        } catch (err) {
            console.error('[useEphemeralSession] Failed to join:', err);
        }
    };

    const leave = () => {
        if (socket && roomId) socket.emit('leave-room', { roomId });
        roomClient?.leaveRoom();
        setJoined(false);
        setMessages([]);
    };

    const end = async () => {
        if (!hubId) return;
        leave();
        try {
            await endEphemeral(hubId);
            setActive(false);
            setRoomId(null);
        } catch (err) {
            console.error('[useEphemeralSession] Failed to end:', err);
        }
    };

    const send = async (text: string) => {
        if (!roomClient || !text.trim()) return;
        try {
            await roomClient.sendMessage(text.trim());
            setMessages(prev => [...prev, {
                sender: 'me',
                message: text.trim(),
                alias: user?.username ?? 'Me',
            }]);
        } catch (err) {
            console.error('[useEphemeralSession] Failed to send:', err);
        }
    };

    return { active, joined, messages, timeLeft, start, join, leave, end, send };
}