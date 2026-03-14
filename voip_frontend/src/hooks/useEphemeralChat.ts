import { useEffect, useState } from 'react';
import { useServerAPI } from '@/hooks/useServer';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/components/providers/ConnectionProvider';
import type { EphemeralMessage } from '@/types/server.types';

export interface UseEphemeralChatReturn {
    /** Whether an ephemeral room is currently active for this server */
    active: boolean;
    /** Whether the local user has joined the ephemeral room */
    joined: boolean;
    /** Whether the slide-in panel is expanded */
    open: boolean;
    messages: EphemeralMessage[];
    input: string;
    /** Formatted countdown string, e.g. "4:32" — passed to panel + sidebar */
    timeLeft: string;

    setOpen: (v: boolean) => void;
    setInput: (v: string) => void;

    handleStart: () => Promise<void>;
    handleJoin: () => Promise<void>;
    handleLeave: () => void;
    handleEnd: () => Promise<void>;
    handleSend: () => Promise<void>;
}

/**
 * Manages the complete ephemeral-chat lifecycle for a server:
 * polling, countdown, signal-client callbacks, and all action handlers.
 */
export function useEphemeralChat(serverId: string | undefined): UseEphemeralChatReturn {
    const { user } = useAuth();
    const { socket, signalClient } = useConnection();
    const { startEphemeral, getEphemeral, endEphemeral } = useServerAPI();

    const [roomId, setRoomId]       = useState<string | null>(null);
    const [active, setActive]       = useState(false);
    const [open, setOpen]           = useState(false);
    const [joined, setJoined]       = useState(false);
    const [messages, setMessages]   = useState<EphemeralMessage[]>([]);
    const [input, setInput]         = useState('');
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [timeLeft, setTimeLeft]   = useState('');

    // ------------------------------------------------------------------
    // Poll server every 5 s for ephemeral room status
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!serverId) return;

        const check = async () => {
            try {
                const data = await getEphemeral(serverId);
                setActive(data.active);
                if (data.active) {
                    setRoomId(data.roomId);
                    setExpiresAt(data.expiresAt);
                } else {
                    setRoomId(null);
                    setExpiresAt(null);
                    // Room expired while we were in it — clean up locally
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
    }, [serverId, getEphemeral]);

    // ------------------------------------------------------------------
    // 1-second countdown timer
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // Signal-client callback for incoming ephemeral messages
    // ------------------------------------------------------------------
    useEffect(() => {
        if (!signalClient || !joined) return;

        signalClient.onRoomMessageDecrypted = (msg) => {
            setMessages(prev => [...prev, {
                sender: msg.senderUserId,
                message: msg.message,
                alias: msg.senderAlias,
                timestamp: msg.timestamp,
            }]);
        };

        return () => { signalClient.onRoomMessageDecrypted = undefined; };
    }, [signalClient, joined]);

    // ------------------------------------------------------------------
    // Action handlers
    // ------------------------------------------------------------------

    const handleStart = async () => {
        if (!serverId) return;
        const newRoomId = `ephemeral-${serverId}-${Date.now()}`;
        try {
            const data = await startEphemeral(serverId, newRoomId);
            setRoomId(data.roomId);
            setActive(true);
        } catch (err) {
            console.error('[useEphemeralChat] Failed to start:', err);
        }
    };

    const handleJoin = async () => {
        if (!roomId || !signalClient || !socket) return;
        try {
            socket.emit('join-room', {
                roomId,
                alias: user?.username || 'Anonymous',
                userId: user?.username,
            });
            await signalClient.joinRoom(roomId, []);
            setJoined(true);
            setOpen(true);
        } catch (err) {
            console.error('[useEphemeralChat] Failed to join:', err);
        }
    };

    const handleLeave = () => {
        if (socket && roomId) {
            socket.emit('leave-room', { roomId });
        }
        signalClient?.leaveRoom();
        setJoined(false);
        setOpen(false);
        setMessages([]);
    };

    const handleEnd = async () => {
        if (!serverId) return;
        handleLeave();
        try {
            await endEphemeral(serverId);
            setActive(false);
            setRoomId(null);
        } catch (err) {
            console.error('[useEphemeralChat] Failed to end:', err);
        }
    };

    const handleSend = async () => {
        if (!signalClient || !input.trim()) return;
        const text = input.trim();
        try {
            await signalClient.sendRoomMessage(text);
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
