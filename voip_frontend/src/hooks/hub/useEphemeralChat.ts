import { useEffect, useState } from 'react';
import useHubAPI from '@/hooks/hub/useHubAPI';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/components/providers/ConnectionProvider';
import type { EphemeralMessage } from '@/types/hub.types';

export interface UseEphemeralChatReturn {
    active: boolean;
    joined: boolean;
    open: boolean;
    messages: EphemeralMessage[];
    input: string;
    timeLeft: string;
    setOpen: (v: boolean) => void;
    setInput: (v: string) => void;
    handleStart: () => Promise<void>;
    handleJoin: () => Promise<void>;
    handleLeave: () => void;
    handleEnd: () => Promise<void>;
    handleSend: () => Promise<void>;
}

export function useEphemeralChat(hubId: string | undefined): UseEphemeralChatReturn {
    const { user } = useAuth();
    const { socket, roomClient } = useConnection();
    const { startEphemeral, getEphemeral, endEphemeral } = useHubAPI();

    const [roomId, setRoomId]       = useState<string | null>(null);
    const [active, setActive]       = useState(false);
    const [open, setOpen]           = useState(false);
    const [joined, setJoined]       = useState(false);
    const [messages, setMessages]   = useState<EphemeralMessage[]>([]);
    const [input, setInput]         = useState('');
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [timeLeft, setTimeLeft]   = useState('');

    // Poll server every 5 s for ephemeral room status
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
                        if (prev) {
                            setOpen(false);
                            setMessages([]);
                        }
                        return false;
                    });
                }
            } catch {
                // ignore transient errors
            }
        };

        check();
        const id = setInterval(check, 5000);
        return () => clearInterval(id);
    }, [hubId, getEphemeral]);

    // Countdown timer
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

    // Room client message callback
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

    const handleStart = async () => {
        if (!hubId) return;
        const newRoomId = `ephemeral-${hubId}`;
        try {
            const data = await startEphemeral(hubId, newRoomId);
            setRoomId(data.roomId);
            setActive(true);
        } catch (err) {
            console.error('[useEphemeralChat] Failed to start:', err);
        }
    };

    const handleJoin = async () => {
        if (!roomId || !socket || !roomClient) return;
        try {
            const existingUsers = await new Promise<string[]>((resolve) => {
                socket.once('all-users', (users: { peerId: string; alias: string; userId: string }[]) => {
                    resolve(users.map(u => u.userId));
                });
                socket.emit('join-room', {
                    roomId,
                    alias: user?.username || 'Anonymous',
                    userId: user?.username,
                });
            });

            await roomClient.joinRoom(roomId, existingUsers);
            setJoined(true);
            setOpen(true);
        } catch (err) {
            console.error('[useEphemeralChat] Failed to join:', err);
        }
    };

    const handleLeave = () => {
        if (socket && roomId) socket.emit('leave-room', { roomId });
        roomClient?.leaveRoom();
        setJoined(false);
        setOpen(false);
        setMessages([]);
    };

    const handleEnd = async () => {
        if (!hubId) return;
        handleLeave();
        try {
            await endEphemeral(hubId);
            setActive(false);
            setRoomId(null);
        } catch (err) {
            console.error('[useEphemeralChat] Failed to end:', err);
        }
    };

    const handleSend = async () => {
        if (!roomClient || !input.trim()) return;
        const text = input.trim();
        try {
            await roomClient.sendMessage(text);
            setMessages(prev => [...prev, {
                sender: 'me',
                message: text,
                alias: user?.username ?? 'Me',
            }]);
            setInput('');
        } catch (err) {
            console.error('[useEphemeralChat] Failed to send:', err);
        }
    };

    return {
        active, joined, open, messages, input, timeLeft,
        setOpen, setInput,
        handleStart, handleJoin, handleLeave, handleEnd, handleSend,
    };
}